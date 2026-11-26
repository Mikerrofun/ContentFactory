import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FactChunk, Report } from "./types";

export const CHUNKS_DIR = "data/chunks";

export function writeChunkTree(type: string, chunks: FactChunk[]): void {
  const dir = join(CHUNKS_DIR, type);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const chunk of chunks) writeFileSync(join(dir, `${chunk.id}.json`), JSON.stringify(chunk, null, 2) + "\n", "utf8");
}

export function writeReport(type: string, report: Report): void {
  const dir = join(CHUNKS_DIR, type);
  mkdirSync(dir, { recursive: true });
  const lines = [
    `# Отчёт чанкинга: ${type}`,
    "",
    `- Всего чанков: ${report.total}`,
    "",
    "## По источникам",
    ...Object.entries(report.bySource).map(([src, n]) => `- ${src}: ${n}`),
    "",
    "## Предупреждения",
    ...(report.warnings.length ? report.warnings.map((w) => `- ${w}`) : ["- нет"]),
    "",
  ];
  writeFileSync(join(dir, "_report.md"), lines.join("\n"), "utf8");
}

export function readChunkTree(type: string): FactChunk[] {
  const dir = join(CHUNKS_DIR, type);
  if (!existsSync(dir)) return [];
  const out: FactChunk[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json") || file.startsWith("_")) continue;
    out.push(JSON.parse(readFileSync(join(dir, file), "utf8")) as FactChunk);
  }
  return out;
}