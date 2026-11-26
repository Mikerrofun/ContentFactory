import { readFileSync } from "node:fs";
import { clean } from "../lib/clean";
import { writeChunkTree, writeReport } from "../lib/fs";
import type { SwipeChunk, Report } from "../lib/types";
import {
  SWIPES_PATH,
  SOURCE_SWIPE,
  CARD_BOUNDARY,
  SECTION_HEADER_RE,
  COLON_MARKER_RE,
  PAREN_MARKER_RE,
  SWIPE_FIELDS,
  SINGLE_LINE_FIELDS,
  type SwipeField,
} from "./config";

interface RawCard {
  block: string; // вся карточка (META+класс+теги+оригинал+разбор) — он же в text
  fields: Partial<Record<SwipeField, string>>;
}

const FIELD_SET = new Set<string>(SWIPE_FIELDS);
// Однозначные поля: значение только на строке-маркере, continuation не клеим.
const SINGLE_LINE = new Set<string>(SINGLE_LINE_FIELDS);

// `ТЕМА/НИША (1 строка)` → `ТЕМА/НИША`; `ЦА (если понятно)` → `ЦА`.
function canonicalName(raw: string): string {
  return raw.replace(/\s*\(.*\)\s*$/, "").trim();
}

// Открывает поле только известное имя (whitelist). Двоеточие → значение на
// строке-маркере; скобки без двоеточия → значение идёт следующими строками.
function matchField(line: string): { field: SwipeField; value: string } | null {
  const colon = line.match(COLON_MARKER_RE);
  if (colon) {
    const name = canonicalName(colon[1]);
    if (FIELD_SET.has(name)) return { field: name as SwipeField, value: colon[2] ?? "" };
    return null;
  }
  const paren = line.match(PAREN_MARKER_RE);
  if (paren) {
    const name = paren[1].trim();
    if (FIELD_SET.has(name)) return { field: name as SwipeField, value: "" };
  }
  return null;
}

export function parseCards(raw: string): RawCard[] {
  const { text } = clean(raw);
  const cards: RawCard[] = [];
  let cur: RawCard | null = null;
  let curField: SwipeField | null = null;
  let buf: string[] = [];

  const flush = () => {
    if (cur) {
      cur.block = buf.join("\n").trim();
      cards.push(cur);
    }
    cur = null;
    curField = null;
    buf = [];
  };

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line === CARD_BOUNDARY) {
      flush();
      cur = { block: "", fields: {} };
      continue;
    }
    if (!cur) continue; // всё до первой карточки
    buf.push(rawLine); // в text идёт вся карточка целиком

    if (line === "") continue; // пустые — только в text, не в поля
    if (SECTION_HEADER_RE.test(line)) {
      curField = null; // новая секция — текущее поле закрыто
      continue;
    }

    const marker = matchField(line);
    if (marker) {
      curField = marker.field;
      cur.fields[curField] = marker.value;
      continue;
    }
    // Продолжение текущего поля (строки-переносы, буллеты `●`, нумерация).
    if (curField && !SINGLE_LINE.has(curField)) {
      const prev = cur.fields[curField] ?? "";
      cur.fields[curField] = prev ? `${prev}\n${line}` : line;
    }
  }
  flush();
  return cards;
}

// Разбор поля-блока в массив: `bullet` — по маркерам `●` (продолжения
// склеиваются пробелом); `line` — каждый непустой Строка скелета.
function toArray(value: string | undefined, mode: "bullet" | "line"): string[] | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (mode === "line") {
    const lines = trimmed.split("\n").map((l) => l.trim()).filter(Boolean);
    return lines.length ? lines : null;
  }

  const bullets: string[] = [];
  let cur: string | null = null;
  for (const raw of trimmed.split("\n")) {
    const l = raw.trim();
    if (!l) continue;
    if (l.startsWith("●")) {
      if (cur) bullets.push(cur);
      cur = l.replace(/^●\s*/, "").trim();
    } else if (cur) {
      cur = `${cur} ${l}`.trim();
    }
  }
  if (cur) bullets.push(cur);
  return bullets.length ? bullets : null;
}

function toChunk(card: RawCard, id: string, addedAt: string): SwipeChunk {
  const pillar = (card.fields.PILLAR ?? "").trim() || null;
  const format = (card.fields.FORMAT ?? "").trim() || null;
  return {
    id,
    type: "swipe",
    text: card.block,
    pillar,
    format,
    sourcePath: SOURCE_SWIPE,
    whyItWorks: toArray(card.fields.WHY_IT_WORKS, "bullet"),
    structure: toArray(card.fields.STRUCTURE, "line"),
    patternsToBorrow: toArray(card.fields.PATTERNS_TO_BORROW, "bullet"),
    doNotCopy: toArray(card.fields.DO_NOT_COPY, "bullet"),
    embedding: null,
    addedAt,
  };
}

export function runSwipeChunker(): { chunks: SwipeChunk[]; report: Report } {
  const addedAt = new Date().toISOString();
  const cards = parseCards(readFileSync(SWIPES_PATH, "utf8"));
  const chunks = cards.map((c, i) => toChunk(c, `SW-${String(i + 1).padStart(4, "0")}`, addedAt));

  const bySource: Record<string, number> = {};
  for (const c of chunks) bySource[c.sourcePath] = (bySource[c.sourcePath] ?? 0) + 1;

  const report: Report = { type: "swipe", total: chunks.length, bySource, warnings: [] };
  writeChunkTree("swipe", chunks);
  writeReport("swipe", report);
  return { chunks, report };
}