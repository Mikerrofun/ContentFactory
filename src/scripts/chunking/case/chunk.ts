import { readFileSync } from "node:fs";
import { clean } from "../lib/clean";
import { writeChunkTree, writeReport } from "../lib/fs";
import type { CaseChunk, Report } from "../lib/types";
import { CASE_FIELDS, CASE_PATH, SOURCE_CASE, TEXT_ORDER, type CaseField } from "./config";
import type { RawCard } from "./types";

const FIELD_SET = new Set<string>(CASE_FIELDS);
// Однозначные поля: значение только на строке-маркере. Если в источнике
// отсутствует заголовок следующей секции (напр. START), её буллеты идут
// после `pillar:` — их к таким полям не клеим.
const SINGLE_LINE = new Set<string>(["source_type", "source_link", "date", "topic", "pillar"]);
const HEADER_RE = /^##\s+(CASE_\d+)\b/;
const MARKER_RE = /^([A-Za-zА-Яа-яЁё ()0-9_-]+):\s?(.*)$/;

function matchField(line: string): { field: CaseField; value: string } | null {
  const m = line.match(MARKER_RE);
  if (!m) return null;
  const name = m[1].trim();
  if (!FIELD_SET.has(name)) return null;
  return { field: name as CaseField, value: m[2] ?? "" };
}

export function parseCases(raw: string): RawCard[] {
  const { text } = clean(raw);
  const cards: RawCard[] = [];
  let cur: RawCard | null = null;
  let curField: CaseField | null = null;
  const flush = () => {
    if (cur) cards.push(cur);
    cur = null;
    curField = null;
  };

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line === "") continue;

    const header = line.match(HEADER_RE);
    if (header) {
      flush();
      cur = { id: header[1], fields: {} };
      continue;
    }
    if (!cur) continue; // шапка файла до первого CASE

    const marker = matchField(line);
    if (marker) {
      curField = marker.field;
      cur.fields[curField] = marker.value;
      continue;
    }
    // Продолжение текущего поля (буллеты `•`, нумерация `1.`, строки без маркера).
    if (curField && !SINGLE_LINE.has(curField)) {
      const prev = cur.fields[curField] ?? "";
      cur.fields[curField] = prev ? `${prev}\n${line}` : line;
    }
  }
  flush();
  return cards;
}

function buildText(fields: Partial<Record<CaseField, string>>): string {
  const parts: string[] = [];
  for (const key of TEXT_ORDER) {
    const val = (fields[key] ?? "").trim();
    if (val) parts.push(`${key}: ${val}`);
  }
  return parts.join("\n");
}

function toChunk(card: RawCard): CaseChunk {
  const topic = (card.fields.topic ?? "").trim() || null;
  const pillar = (card.fields.pillar ?? "").trim() || null;
  return {
    id: card.id,
    type: "case",
    text: buildText(card.fields),
    topic,
    pillar,
    sourcePath: SOURCE_CASE,
    fearClosed: null,
    depletion: 1.0,
    cooldownUntil: null,
    embedding: null,
  };
}

export function runCaseChunker(): { chunks: CaseChunk[]; report: Report } {
  const chunks = parseCases(readFileSync(CASE_PATH, "utf8")).map((c) => toChunk(c));

  const bySource: Record<string, number> = {};
  for (const c of chunks) bySource[c.sourcePath] = (bySource[c.sourcePath] ?? 0) + 1;

  const report: Report = { type: "case", total: chunks.length, bySource, warnings: [] };
  writeChunkTree("case", chunks);
  writeReport("case", report);
  return { chunks, report };
}