import { readFileSync } from "node:fs";
import { clean } from "../lib/clean";
import { writeChunkTree, writeReport } from "../lib/fs";
import type { CanPublish, FactChunk, Report } from "../lib/types";

const FACTS_PATH = "docs/Facts:Case:Best/FACTS.md";
const PRODUCT_FACTS_PATH = "docs/Info_ForGeneration/PRODUCT_FACTS.md";
const SOURCE_FACTS = "docs/Facts:Case:Best/FACTS.md";
const SOURCE_PF = "docs/Info_ForGeneration/PRODUCT_FACTS.md";

const KNOWN_FIELDS = new Set(["ID", "Период", "Сцена", "Контекст", "Что произошло", "Мой вывод", "Эмоция/тон", "Можно публично", "Запреты/триггеры", "Теги"]);
const TEXT_ORDER = ["Период", "Сцена", "Контекст", "Что произошло", "Мой вывод", "Эмоция/тон", "Можно публично", "Запреты/триггеры", "Теги"];

interface RawCard {
  fields: Record<string, string>;
}

const isCardHeader = (line: string) => line === "## Карточка" || /^Карточка\s*:/.test(line);
const isSeparator = (line: string) => /^-{4,}$/.test(line);

export function parseFacts(raw: string): RawCard[] {
  const { text } = clean(raw);
  const cards: RawCard[] = [];
  let cur: RawCard | null = null;
  let curField: string | null = null;
  const flush = () => {
    if (cur && Object.keys(cur.fields).length > 0) cards.push(cur);
    cur = null;
    curField = null;
  };

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line === "") continue;
    if (isCardHeader(line)) {
      flush();
      cur = { fields: {} };
      continue;
    }
    if (isSeparator(line)) {
      flush();
      continue;
    }
    if (!cur) continue;

    const m = line.match(/^[-•]\s*([^:]+):\s?(.*)$/);
    if (m && KNOWN_FIELDS.has(m[1].trim())) {
      curField = m[1].trim();
      cur.fields[curField] = m[2] ?? "";
      continue;
    }
    if (curField) {
      const prev = cur.fields[curField] ?? "";
      cur.fields[curField] = prev ? `${prev}\n${line}` : line;
    }
  }
  flush();
  return cards;
}

function mapCanPublish(value: string | undefined): CanPublish {
  const v = (value ?? "").trim().toLowerCase();
  if (v.includes("оговор")) return "partial";
  if (v.startsWith("нет")) return "no";
  return "yes";
}

function buildText(fields: Record<string, string>): string {
  const parts: string[] = [];
  for (const key of TEXT_ORDER) {
    const val = (fields[key] ?? "").trim();
    if (val) parts.push(`${key}: ${val}`);
  }
  return parts.join("\n");
}

function cardsToChunks(cards: RawCard[]): FactChunk[] {
  return cards.map((card) => ({
    id: (card.fields.ID ?? "").trim(),
    type: "fact",
    text: buildText(card.fields),
    canPublish: mapCanPublish(card.fields["Можно публично"]),
    sourcePath: SOURCE_FACTS,
  }));
}

export function parseProductFacts(raw: string): FactChunk[] {
  const { text } = clean(raw);
  const chunks: FactChunk[] = [];
  let n = 0;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("- Факт:")) continue;
    n += 1;
    chunks.push({ id: `PF-${String(n).padStart(4, "0")}`, type: "fact", text: line.replace(/^-\s*Факт:\s*/, ""), canPublish: "yes", sourcePath: SOURCE_PF });
  }
  return chunks;
}

export function runFactChunker(): { chunks: FactChunk[]; report: Report } {
  const facts = cardsToChunks(parseFacts(readFileSync(FACTS_PATH, "utf8")));
  const pf = parseProductFacts(readFileSync(PRODUCT_FACTS_PATH, "utf8"));
  const chunks = [...facts, ...pf];

  const bySource: Record<string, number> = {};
  for (const c of chunks) bySource[c.sourcePath] = (bySource[c.sourcePath] ?? 0) + 1;

  const report: Report = { type: "fact", total: chunks.length, bySource, warnings: [] };
  writeChunkTree("fact", chunks);
  writeReport("fact", report);
  return { chunks, report };
}