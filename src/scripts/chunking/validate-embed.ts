// Гейт валидации эмбеддингов: tsx src/scripts/chunking/validate-embed.ts [type]
// Проверяет длину вектора = EMBEDDING_DIM, отсутствие null, счётчик = числу чанков.
import "dotenv/config";
import { config } from "../../config/env";
import { prisma } from "../../db/prisma";
import { countChunks, getChunksNeedingEmbedding, getVectorLength } from "./lib/embed";

const type = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "fact";

async function main() {
  const total = await countChunks(type);
  const rows = await getChunksNeedingEmbedding(type);
  console.log(`[validate-embed] ${type}: чанков в БД ${total}`);

  const errors: string[] = [];
  if (total !== rows.length) errors.push(`счётчик ${rows.length} != чанков ${total}`);

  for (const r of rows) {
    if (!r.embeddingHash) {
      errors.push(`${r.id}: нет embeddingHash`);
      continue;
    }
    const len = await getVectorLength(r.id);
    if (len === null) errors.push(`${r.id}: chunkEmbedding = NULL`);
    else if (len !== config.EMBEDDING_DIM) errors.push(`${r.id}: длина ${len} != ${config.EMBEDDING_DIM}`);
  }

  for (const e of errors) console.log(`ERROR ${e}`);
  console.log(`\n[validate-embed] ${type}: errors=${errors.length}`);
  if (errors.length > 0) {
    console.error("[validate-embed] FAIL");
    process.exit(1);
  }
  console.log("[validate-embed] OK");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());