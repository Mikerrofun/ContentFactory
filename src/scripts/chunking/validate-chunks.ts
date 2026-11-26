// Гейт валидации: npx tsx src/scripts/chunking/validate-chunks.ts [type]
// Читает data/chunks/<type> и проверяет каждый чанк. Exit 1 при ошибках.
// Отдельно от чанкера: проверяет результат, а не сам себя.
import { readChunkTree } from "./lib/fs";
import { validateSet, summarize, type Violation } from "./fact/validate";
import type { FactChunk } from "./lib/types";

const EXPECTED: Record<string, { fact?: number; pf?: number }> = {
  fact: { fact: 71 },
};

function main() {
  const type = process.argv[2] ?? "fact";
  const chunks = readChunkTree<FactChunk>(type);

  if (chunks.length === 0) {
    console.error(`[validate] нет чанков в data/chunks/${type} — сначала запусти чанкер`);
    process.exit(1);
  }

  const violations: Violation[] = validateSet(chunks, EXPECTED[type]);
  const { errors, warnings } = summarize(violations);

  for (const v of violations) {
    const where = v.chunkId ? ` [${v.chunkId}]` : "";
    console.log(`${v.severity === "error" ? "ERROR" : "WARN "} ${v.criterion}${where}: ${v.message}`);
  }

  console.log(`\n[validate] ${type}: ${chunks.length} чанков, errors=${errors}, warnings=${warnings}`);
  if (errors > 0) {
    console.error("[validate] FAIL");
    process.exit(1);
  }
  console.log("[validate] OK");
}

main();