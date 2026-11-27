import { readFileSync } from "node:fs";
import { readChunkTree } from "../../lib/fs";
import {
  LLM_CONCURRENCY,
  VALIDATE_ATTEMPTS,
  chatJSONWithFallback,
  mapLimit,
  writeLlmReport,
} from "../../lib/llm";
import type { AudienceChunk } from "../../lib/types";
import { FEAR_EMOTIONS } from "../config";
import { FEAR_REFERENCE_PATH, buildAudienceMessages } from "./config";
import { LLM_PROMPT_VERSION } from "../../lib/llm";
import { getChunksMissing, updateFearType } from "./store";
import { validateAudienceAnswer } from "./validate";
import type { AudienceRunOptions, AudienceRunResult, FillOutcome, LlmChunkRow } from "./types";

// Один чанк: до VALIDATE_ATTEMPTS запросов, пока ответ не пройдёт валидацию.
async function fillOne(row: LlmChunkRow, reference: string): Promise<FillOutcome> {
  const messages = buildAudienceMessages(row.text, reference);
  let lastError = "неизвестная ошибка";
  for (let attempt = 1; attempt <= VALIDATE_ATTEMPTS; attempt += 1) {
    try {
      const { data, model } = await chatJSONWithFallback(messages);
      const checked = validateAudienceAnswer(data);
      if (checked.ok) return { ok: true, value: checked.value, model };
      lastError = checked.error;
    } catch (e) {
      lastError = (e as Error).message;
    }
  }
  return { ok: false, error: lastError };
}

export async function runAudienceLLM(opts: AudienceRunOptions): Promise<AudienceRunResult> {
  const reference = readFileSync(FEAR_REFERENCE_PATH, "utf8");
  let rows: LlmChunkRow[] = opts.apply
    ? await getChunksMissing(opts.force)
    : readChunkTree<AudienceChunk>("audience")
        .filter((c) => (c.emotion !== null && FEAR_EMOTIONS.includes(c.emotion) && (opts.force || c.fearType === null)))
        .map((c) => ({ id: c.id, text: c.text }));

  if (opts.limit) rows = rows.slice(0, opts.limit);

  const models: Record<string, number> = {};
  const failedIds: string[] = [];
  const result: AudienceRunResult = {
    total: rows.length,
    filled: 0,
    skipped: 0,
    failed: 0,
    failedIds,
    models,
    dryRun: !opts.apply,
  };

  if (rows.length === 0) {
    console.error("[llm:audience] нет фраз-страхов с пустым fearType — сначала chunk:load --apply");
    return result;
  }

  if (!opts.apply && !opts.probe) {
    console.log(`[llm:audience] dry-run: всего ${rows.length}, в БД не пишем`);
    for (const r of rows.slice(0, 5)) console.log(`  ${r.id} ${r.text.slice(0, 60)}…`);
    if (rows.length > 5) console.log(`  … и ещё ${rows.length - 5}`);
    return result;
  }

  const targets = opts.probe ? rows.slice(0, opts.probe) : rows;
  await mapLimit(targets, LLM_CONCURRENCY, async (row) => {
    const res = await fillOne(row, reference);
    if (!res.ok) {
      result.failed += 1;
      failedIds.push(row.id);
      console.error(`[llm:audience] ${row.id} → failed: ${res.error}`);
      return;
    }
    models[res.model] = (models[res.model] ?? 0) + 1;
    if (opts.apply) await updateFearType(row.id, res.value.fearType, { model: res.model, version: LLM_PROMPT_VERSION });
    result.filled += 1;
    console.log(`[llm:audience] ${row.id} → ${res.value.fearType ?? "null"} (${res.model})`);
  });

  writeLlmReport({
    type: "audience",
    field: "fearType",
    total: result.total,
    filled: result.filled,
    skipped: result.skipped,
    failed: result.failed,
    models,
    failedIds,
    dryRun: !opts.apply,
  });
  return result;
}