// Универсальный эмбеддинг-скрипт: tsx src/scripts/chunking/embed.ts [type] [--apply]
// type: fact|case|best|audience|swipe|all. Без --apply — dry-run (без БД и записи).
import "dotenv/config";
import { config } from "../../config/env";
import { prisma } from "../../db/prisma";
import { withRetry } from "../../shared/lib/net/with-retry";
import { readChunkTree } from "./lib/fs";
import { embedBatch, getChunksNeedingEmbedding, hashEmbedding, upsertEmbedding } from "./lib/embed";
import type { EmbedRequest, EmbeddingRow } from "./lib/embed";
import { CHUNK_TYPES } from "./lib/types";

const TYPES = CHUNK_TYPES;
const APPLY = process.argv.includes("--apply");
const arg = process.argv.slice(2).find((a) => !a.startsWith("--"));
const type = arg ?? "fact";

const req: EmbedRequest = {
  model: config.EMBEDDING_MODEL,
  inputType: config.EMBEDDING_INPUT_TYPE,
  dims: config.EMBEDDING_DIM,
};

function dryRunRows(type: string): EmbeddingRow[] {
  return readChunkTree<{ id: string; text: string }>(type).map((c) => ({
    id: c.id,
    text: c.text,
    embeddingHash: null,
  }));
}

async function runType(t: string) {
  const rows = APPLY ? await getChunksNeedingEmbedding(t) : dryRunRows(t);
  if (rows.length === 0) {
    console.error(`[embed] нет чанков типа "${t}"${APPLY ? " в БД — сначала chunk:load --apply" : " в data/chunks"}`);
    return { embedded: 0, skipped: 0, failed: 0 };
  }

  const pending = rows.filter((r) => {
    const h = hashEmbedding(r.text, req);
    return r.embeddingHash !== h;
  });
  const skipped = rows.length - pending.length;
  console.log(`[embed] ${t}: всего ${rows.length}, пропущено ${skipped}, к обработке ${pending.length}`);

  if (!APPLY) {
    for (const r of pending.slice(0, 5)) console.log(`  ${r.id} ${r.text.slice(0, 60)}…`);
    if (pending.length > 5) console.log(`  … и ещё ${pending.length - 5}`);
    return { embedded: 0, skipped, failed: 0 };
  }

  const batchSize = 32;
  let embedded = 0;
  let failed = 0;
  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    try {
      const vectors = await withRetry(() => embedBatch(batch.map((r) => r.text), req), {
        attempts: 5,
        backoffMs: 1500,
      });
      for (let j = 0; j < batch.length; j += 1) {
        const row = batch[j];
        const hash = hashEmbedding(row.text, req);
        await upsertEmbedding(row.id, vectors[j], hash, req.model, req.dims);
        embedded += 1;
      }
    } catch (e) {
      failed += batch.length;
      console.error(`[embed] ${t} batch ${i}-${i + batch.length}: ${(e as Error).message}`);
    }
    console.log(`[embed] ${t}: ${Math.min(i + batchSize, pending.length)}/${pending.length}`);
  }
  return { embedded, skipped, failed };
}

async function main() {
  const targets = type === "all" ? [...TYPES] : [type];
  if (![...TYPES, "all"].includes(type as never)) {
    console.error(`[embed] тип "${type}" не поддерживается (доступен: ${TYPES.join(", ")}, all)`);
    process.exit(1);
  }

  console.log(`[embed] модель=${req.model} dims=${req.dims} input_type=${req.inputType}`);
  console.log(`[embed] режим: ${APPLY ? "APPLY (запись в БД)" : "dry-run"}`);

  let embedded = 0;
  let skipped = 0;
  let failed = 0;
  for (const t of targets) {
    const r = await runType(t);
    embedded += r.embedded;
    skipped += r.skipped;
    failed += r.failed;
  }
  console.log(`[embed] итого: embedded=${embedded}, skipped=${skipped}, failed=${failed}`);
  if (failed > 0) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());