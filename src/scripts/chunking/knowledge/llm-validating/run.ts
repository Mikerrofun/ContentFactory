import { readFileSync } from "node:fs";
import { config } from "../../../../config/env";
import { withRetry } from "../../../../shared/lib/net/with-retry";
import { readChunkTree } from "../../lib/fs";
import { embedBatch, type EmbedRequest } from "../../lib/embed";
import {
  LLM_CONCURRENCY,
  VALIDATE_ATTEMPTS,
  chatJSONWithFallback,
  mapLimit,
  writeLlmReport,
} from "../../lib/llm";
import type { KnowledgeChunk } from "../../lib/types";
import { KNOWLEDGE_LLM_PROMPT_VERSION, TOPIC_REFERENCE_PATH, buildKnowledgeMessages } from "./config";
import { getChunksMissing, updateKnowledgeFields } from "./store";
import { validateKnowledgeAnswer } from "./validate";
import type { FillOutcome, KnowledgeRunOptions, KnowledgeRunResult, LlmChunkRow } from "./types";

const EMBED_REQ: EmbedRequest = {
  model: config.EMBEDDING_MODEL,
  inputType: config.EMBEDDING_INPUT_TYPE,
  dims: config.EMBEDDING_DIM,
};

// Один чанк: до VALIDATE_ATTEMPTS запросов, пока ответ не пройдёт валидацию.
async function fillOne(row: LlmChunkRow, reference: string): Promise<FillOutcome> {
  const messages = buildKnowledgeMessages(row.text, reference);
  let lastError = "неизвестная ошибка";
  for (let attempt = 1; attempt <= VALIDATE_ATTEMPTS; attempt += 1) {
    try {
      const { data, model } = await chatJSONWithFallback(messages);
      const checked = validateKnowledgeAnswer(data);
      if (checked.ok) return { ok: true, value: checked.value, model };
      lastError = checked.error;
    } catch (e) {
      lastError = (e as Error).message;
    }
  }
  return { ok: false, error: lastError };
}

export async function runKnowledgeLLM(opts: KnowledgeRunOptions): Promise<KnowledgeRunResult> {
  const reference = readFileSync(TOPIC_REFERENCE_PATH, "utf8");
  let rows: LlmChunkRow[] = opts.apply
    ? await getChunksMissing(opts.force)
    : readChunkTree<KnowledgeChunk>("knowledge")
        .filter((c) => opts.force || c.facts === null)
        .map((c) => ({ id: c.id, text: c.text }));

  if (opts.limit) rows = rows.slice(0, opts.limit);

  const models: Record<string, number> = {};
  const failedIds: string[] = [];
  const result: KnowledgeRunResult = {
    total: rows.length,
    filled: 0,
    skipped: 0,
    failed: 0,
    failedIds,
    models,
    dryRun: !opts.apply,
  };

  if (rows.length === 0) {
    console.error("[llm:knowledge] нет чанков с пустым facts — сначала chunk:load --apply");
    return result;
  }

  if (!opts.apply && !opts.probe) {
    console.log(`[llm:knowledge] dry-run: всего ${rows.length}, в БД не пишем`);
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
      console.error(`[llm:knowledge] ${row.id} → failed: ${res.error}`);
      return;
    }
    models[res.model] = (models[res.model] ?? 0) + 1;
    if (opts.apply) {
      // Векторы фактов считаем здесь же (тот же embed-клиент, ключ OPENROUTER_API_KEY_EMBEDING).
      const factEmbeddings = await withRetry(() => embedBatch(res.value.facts, EMBED_REQ), { attempts: 3 });
      await updateKnowledgeFields(
        row.id,
        { ...res.value, factEmbeddings },
        { model: res.model, version: KNOWLEDGE_LLM_PROMPT_VERSION },
      );
    }
    result.filled += 1;
    console.log(`[llm:knowledge] ${row.id} → topic=${res.value.topic ?? "—"} facts=${res.value.facts.length} (${res.model})`);
  });

  writeLlmReport({
    type: "knowledge",
    field: "facts/topic/factEmbeddings",
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