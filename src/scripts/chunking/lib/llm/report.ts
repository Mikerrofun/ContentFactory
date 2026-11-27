import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LlmTypeReport } from "./types";

export const LLM_REPORT_DIR = "data/llm-content";

// Отчёт по типу: data/llm-content/<type>.md. Сырые ответы — только в лог.
export function writeLlmReport(report: LlmTypeReport): void {
  mkdirSync(LLM_REPORT_DIR, { recursive: true });
  const lines = [
    `# LLM-заполнение: ${report.type}.${report.field}`,
    "",
    `- Режим: ${report.dryRun ? "dry-run (БД не тронута)" : "APPLY (запись в БД)"}`,
    `- Всего чанков: ${report.total}`,
    `- Заполнено: ${report.filled}`,
    `- Пропущено: ${report.skipped}`,
    `- Failed: ${report.failed}`,
    "",
    "## Модели",
    ...Object.entries(report.models).map(([m, n]) => `- ${m}: ${n}`),
    "",
    "## Failed",
    ...(report.failedIds.length ? report.failedIds.map((id) => `- ${id}`) : ["- нет"]),
    "",
  ];
  writeFileSync(join(LLM_REPORT_DIR, `${report.type}.md`), lines.join("\n"), "utf8");
}