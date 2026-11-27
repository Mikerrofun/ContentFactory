// Бэкфилл метаданных LLM-заполнения для уже прогнанных чанков.
// Точную модель по каждому чанку восстановить нельзя (в логах она была),
// поэтому пишем «mixed» + версию промпта; дальше run.ts пишет уже точно.
import "dotenv/config";
import { prisma } from "../../db/prisma";
import { LLM_PROMPT_VERSION } from "./lib/llm";
import { FEAR_EMOTIONS } from "../chunking/audience/config";

const TYPES = ["case", "best", "audience"] as const;
const MIXED_MODEL = "mixed:baidu/ernie-5.5-flash-preview:free+z-ai/glm-5.3-flash";
const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(`[backfill] режим: ${APPLY ? "APPLY" : "dry-run"}, версия=${LLM_PROMPT_VERSION}`);
  for (const type of TYPES) {
    // audience: LLM-заполнение только у фраз-страхов, остальные не трогаем.
    const where =
      type === "audience"
        ? { type, llmProcessedAt: null, emotion: { in: [...FEAR_EMOTIONS] } }
        : { type, llmProcessedAt: null };
    const rows = await prisma.chunk.findMany({ where, select: { id: true } });
    console.log(`[backfill] ${type}: без llmProcessedAt — ${rows.length}`);
    if (!APPLY) continue;
    const res = await prisma.chunk.updateMany({
      where,
      data: { llmProcessedAt: new Date(), llmModel: MIXED_MODEL, llmPromptVersion: LLM_PROMPT_VERSION },
    });
    console.log(`[backfill] ${type}: обновлено ${res.count}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());