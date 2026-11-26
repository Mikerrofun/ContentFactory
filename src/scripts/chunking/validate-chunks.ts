// Гейт валидации: npx tsx src/scripts/chunking/validate-chunks.ts [type]
// Читает data/chunks/<type> и проверяет каждый чанк. Exit 1 при ошибках.
// Отдельно от чанкера: проверяет результат, а не сам себя.
import { readChunkTree } from "./lib/fs";
import { validateSet as validateFact, summarize, type Violation } from "./fact/validate";
import { validateSet as validateCase } from "./case/validate";
import { validateSet as validateBest } from "./best/validate";
import { validateSet as validateAudience } from "./audience/validate";
import { validateSet as validateSwipe } from "./swipe/validate";
import type { FactChunk, CaseChunk, BestChunk, AudienceChunk, SwipeChunk } from "./lib/types";

type Runner = (chunks: unknown[]) => Violation[];

const RUNNERS: Record<string, Runner> = {
  fact: (chunks) => validateFact(chunks as FactChunk[], { fact: 71 }),
  case: (chunks) => validateCase(chunks as CaseChunk[], 68),
  best: (chunks) => validateBest(chunks as BestChunk[], 64),
  audience: (chunks) => validateAudience(chunks as AudienceChunk[]),
  swipe: (chunks) => validateSwipe(chunks as SwipeChunk[], 56),
};

function main() {
  const type = process.argv[2] ?? "fact";
  const run = RUNNERS[type];
  if (!run) {
    console.error(`[validate] тип "${type}" не поддерживается (доступен: fact, case, best, audience, swipe)`);
    process.exit(1);
  }

  const chunks = readChunkTree<unknown>(type);
  if (chunks.length === 0) {
    console.error(`[validate] нет чанков в data/chunks/${type} — сначала запусти чанкер`);
    process.exit(1);
  }

  const violations: Violation[] = run(chunks);
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