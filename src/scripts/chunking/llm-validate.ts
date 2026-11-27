// Диспетчер LLM-заполнения: tsx src/scripts/chunking/llm-validate.ts <type> [--apply] [--force] [--probe N] [--limit N]
// type: case|best|audience|all. Без --apply — dry-run (БД не трогаем).
// --force — перезаписать и непустые поля; --probe N — N чанков с вызовом модели без записи;
// --limit N — не больше N чанков за прогон (удобно для :free-лимитов).
import "dotenv/config";
import { prisma } from "../../db/prisma";
import { LLM_CONCURRENCY, LLM_FALLBACK_MODEL, LLM_MODEL } from "./lib/llm";
import { runCaseLLM } from "./case/llm-validating/run";
import { runBestLLM } from "./best/llm-validating/run";
import { runAudienceLLM } from "./audience/llm-validating/run";

const TYPES = ["case", "best", "audience"] as const;
type LlmType = (typeof TYPES)[number];

const APPLY = process.argv.includes("--apply");
const FORCE = process.argv.includes("--force");

// --probe N / --probe=N: вызвать модель на N чанках, но в БД не писать.
// --limit N / --limit=N: обработать не больше N чанков за прогон.
function readFlagValue(argv: string[], name: string): number {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === name) return Number(argv[i + 1] ?? 0);
    if (argv[i].startsWith(`${name}=`)) return Number(argv[i].slice(name.length + 1));
  }
  return 0;
}
const PROBE = readFlagValue(process.argv.slice(2), "--probe");
const LIMIT = readFlagValue(process.argv.slice(2), "--limit");

// Позиционный аргумент — тип; значения после --probe/--limit типом не считаем.
function readType(argv: string[]): string {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--probe" || argv[i] === "--limit") {
      i += 1;
      continue;
    }
    if (!argv[i].startsWith("--")) return argv[i];
  }
  return "case";
}
const type = readType(process.argv.slice(2));

async function main() {
  if (![...TYPES, "all"].includes(type as never)) {
    console.error(`[llm-validate] тип "${type}" не поддерживается (доступно: ${TYPES.join(", ")}, all)`);
    process.exit(1);
  }

  console.log(`[llm-validate] модель=${LLM_MODEL} фоллбэк=${LLM_FALLBACK_MODEL} concurrency=${LLM_CONCURRENCY}`);
  console.log(`[llm-validate] режим: ${APPLY ? "APPLY (запись в БД)" : "dry-run"}${FORCE ? " + force" : ""}${PROBE ? ` + probe ${PROBE}` : ""}${LIMIT ? ` + limit ${LIMIT}` : ""}`);

  const targets: LlmType[] = type === "all" ? [...TYPES] : [type as LlmType];
  let failed = 0;
  for (const t of targets) {
    const opts = { apply: APPLY, force: FORCE, probe: PROBE || undefined, limit: LIMIT || undefined };
    const r =
      t === "case" ? await runCaseLLM(opts) : t === "best" ? await runBestLLM(opts) : await runAudienceLLM(opts);
    console.log(`[llm-validate] ${t}: всего=${r.total} заполнено=${r.filled} failed=${r.failed}`);
    failed += r.failed;
  }
  if (failed > 0) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());