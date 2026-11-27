import { readFileSync } from "node:fs";
import { readChunkTree } from "../../lib/fs";
import {
  LLM_CONCURRENCY,
  VALIDATE_ATTEMPTS,
  chatJSONWithFallback,
  mapLimit,
  writeLlmReport,
} from "../../lib/llm";
import type { BestChunk, BestMarkers } from "../../lib/types";
import { BEST_MAX_TOKENS, MARKER_REFERENCES, VOICE_REFERENCE_PATH, buildBestMessages } from "./config";
import { getChunksMissing, updateBestFields } from "./store";
import { validateBestAnswer } from "./validate";
import type { BestRunOptions, BestRunResult, Dicts, FillOutcome, LlmChunkRow } from "./types";
import { LLM_PROMPT_VERSION } from "../../lib/llm";

function loadDicts(): Dicts {
  return {
    fear: readFileSync(MARKER_REFERENCES.fear, "utf8"),
    bio: readFileSync(MARKER_REFERENCES.bio, "utf8"),
    emotional: readFileSync(MARKER_REFERENCES.emotional, "utf8"),
    anti: readFileSync(MARKER_REFERENCES.anti, "utf8"),
  };
}

function dictsToReference(dicts: Dicts): string {
  return (Object.keys(dicts) as Array<keyof BestMarkers>)
    .map((key) => `### ${key}\n${dicts[key]}`)
    .join("\n\n");
}

// Один чанк: до VALIDATE_ATTEMPTS запросов, пока ответ не пройдёт валидацию.
// Промпт тяжёлый (VOICE.md + 4 словаря), поэтому max_tokens с запасом.
async function fillOne(row: LlmChunkRow, reference: string, markersReference: string, dicts: Dicts): Promise<FillOutcome> {
  const messages = buildBestMessages(row.text, reference, markersReference);
  let lastError = "неизвестная ошибка";
  for (let attempt = 1; attempt <= VALIDATE_ATTEMPTS; attempt += 1) {
    try {
      const { data, model } = await chatJSONWithFallback(messages, { maxTokens: BEST_MAX_TOKENS });
      const checked = validateBestAnswer(data, dicts);
      if (checked.ok) return { ok: true, value: checked.value, model };
      lastError = Object.values(checked.errors).join("; ");
    } catch (e) {
      lastError = (e as Error).message;
    }
  }
  return { ok: false, error: lastError };
}

export async function runBestLLM(opts: BestRunOptions): Promise<BestRunResult> {
  const reference = readFileSync(VOICE_REFERENCE_PATH, "utf8");
  const dicts = loadDicts();
  const markersReference = dictsToReference(dicts);

  let rows: LlmChunkRow[] = opts.apply
    ? await getChunksMissing(opts.force)
    : readChunkTree<BestChunk>("best")
        .filter((c) => opts.force || c.sScheme === null || c.closingType === null || c.markers === null)
        .map((c) => ({ id: c.id, text: c.text }));

  if (opts.limit) rows = rows.slice(0, opts.limit);

  const models: Record<string, number> = {};
  const failedIds: string[] = [];
  const result: BestRunResult = {
    total: rows.length,
    filled: 0,
    skipped: 0,
    failed: 0,
    failedIds,
    models,
    dryRun: !opts.apply,
  };

  if (rows.length === 0) {
    console.error("[llm:best] нет чанков с пустыми полями — сначала chunk:load --apply");
    return result;
  }

  if (!opts.apply && !opts.probe) {
    console.log(`[llm:best] dry-run: всего ${rows.length}, в БД не пишем`);
    for (const r of rows.slice(0, 5)) console.log(`  ${r.id} ${r.text.slice(0, 60)}…`);
    if (rows.length > 5) console.log(`  … и ещё ${rows.length - 5}`);
    return result;
  }

  const targets = opts.probe ? rows.slice(0, opts.probe) : rows;
  await mapLimit(targets, LLM_CONCURRENCY, async (row) => {
    const res = await fillOne(row, reference, markersReference, dicts);
    if (!res.ok) {
      result.failed += 1;
      failedIds.push(row.id);
      console.error(`[llm:best] ${row.id} → failed: ${res.error}`);
      return;
    }
    models[res.model] = (models[res.model] ?? 0) + 1;
    if (opts.apply) await updateBestFields(row.id, res.value, { model: res.model, version: LLM_PROMPT_VERSION });
    result.filled += 1;
    console.log(`[llm:best] ${row.id} → ${res.value.sScheme ?? "—"}/${res.value.closingType ?? "—"} (${res.model})`);
  });

  writeLlmReport({
    type: "best",
    field: "sScheme/closingType/markers",
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