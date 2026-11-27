import { readFileSync } from "node:fs";
import { readChunkTree } from "../../lib/fs";
import {
  LLM_CONCURRENCY,
  VALIDATE_ATTEMPTS,
  chatJSONWithFallback,
  mapLimit,
  writeLlmReport,
} from "../../lib/llm";
import type { CaseChunk } from "../../lib/types";
import { FEAR_REFERENCE_PATH, buildCaseMessages } from "./config";
import { LLM_PROMPT_VERSION } from "../../lib/llm";
import { getChunksMissing, updateFearClosed } from "./store";
import { validateCaseAnswer } from "./validate";
import type { CaseRunOptions, CaseRunResult, FillOutcome, LlmChunkRow } from "./types";

// Один чанк: до VALIDATE_ATTEMPTS запросов, пока ответ не пройдёт валидацию.
async function fillOne(row: LlmChunkRow, reference: string): Promise<FillOutcome> {
  const messages = buildCaseMessages(row.text, reference);
  let lastError = "неизвестная ошибка";
  for (let attempt = 1; attempt <= VALIDATE_ATTEMPTS; attempt += 1) {
    try {
      const { data, model } = await chatJSONWithFallback(messages);
      const checked = validateCaseAnswer(data);
      if (checked.ok) return { ok: true, value: checked.value, model };
      lastError = checked.error;
    } catch (e) {
      lastError = (e as Error).message;
    }
  }
  return { ok: false, error: lastError };
}

export async function runCaseLLM(opts: CaseRunOptions): Promise<CaseRunResult> {
  const reference = readFileSync(FEAR_REFERENCE_PATH, "utf8");
  let rows: LlmChunkRow[] = opts.apply
    ? await getChunksMissing(opts.force)
    : readChunkTree<CaseChunk>("case")
        .filter((c) => opts.force || c.fearClosed === null)
        .map((c) => ({ id: c.id, text: c.text }));

  if (opts.limit) rows = rows.slice(0, opts.limit);

  const models: Record<string, number> = {};
  const failedIds: string[] = [];
  const result: CaseRunResult = {
    total: rows.length,
    filled: 0,
    skipped: 0,
    failed: 0,
    failedIds,
    models,
    dryRun: !opts.apply,
  };

  if (rows.length === 0) {
    console.error("[llm:case] нет чанков с пустым fearClosed — сначала chunk:load --apply");
    return result;
  }

  if (!opts.apply && !opts.probe) {
    console.log(`[llm:case] dry-run: всего ${rows.length}, в БД не пишем`);
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
      console.error(`[llm:case] ${row.id} → failed: ${res.error}`);
      return;
    }
    models[res.model] = (models[res.model] ?? 0) + 1;
    if (opts.apply) await updateFearClosed(row.id, res.value, { model: res.model, version: LLM_PROMPT_VERSION });
    result.filled += 1;
    console.log(`[llm:case] ${row.id} → ${JSON.stringify(res.value.fearClosed)} (${res.model})`);
  });

  writeLlmReport({
    type: "case",
    field: "fearClosed",
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