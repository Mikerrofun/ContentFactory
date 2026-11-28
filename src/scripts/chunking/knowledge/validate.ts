import type { KnowledgeChunk } from "../lib/types";
import { RESIDUAL_ESCAPE } from "../lib/clean";
import { BLOCK_MAX_WORDS, BLOCK_MIN_WORDS } from "./config";

export type Severity = "error" | "warn";

export interface Violation {
  criterion: string;
  severity: Severity;
  chunkId?: string;
  message: string;
}

interface Criterion {
  id: string;
  severity: Severity;
  check: (chunk: KnowledgeChunk) => string | null;
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export const TEXT_CRITERIA: Criterion[] = [
  { id: "V1-residual-escape", severity: "error", check: (c) => (RESIDUAL_ESCAPE.test(c.text) ? "осталось экранирование markdown" : null) },
  { id: "V2-html-tags", severity: "error", check: (c) => (/<[^>]+>/.test(c.text) ? "HTML-тег в тексте" : null) },
  { id: "V3-double-space", severity: "warn", check: (c) => (/ {2,}/.test(c.text) ? "двойные пробелы" : null) },
  { id: "V4-trailing-space", severity: "warn", check: (c) => (/[ \t]+$/m.test(c.text) ? "пробелы в конце строки" : null) },
  { id: "V5-empty", severity: "error", check: (c) => (c.text.trim().length === 0 ? "пустой text" : null) },
  {
    id: "V6-block-size",
    severity: "warn",
    check: (c) => {
      const n = wordCount(c.text);
      return n < BLOCK_MIN_WORDS || n > BLOCK_MAX_WORDS ? `размер блока ${n} слов вне ${BLOCK_MIN_WORDS}–${BLOCK_MAX_WORDS} (с учётом перекрытия)` : null;
    },
  },
  { id: "V7-replacement-char", severity: "error", check: (c) => (c.text.includes("\uFFFD") ? "символ замены U+FFFD" : null) },
  {
    id: "V8-cyrillic-ratio",
    severity: "warn",
    check: (c) => {
      const letters = c.text.match(/[A-Za-zА-Яа-яЁё]/g)?.length ?? 0;
      if (letters === 0) return "нет букв";
      const cyr = c.text.match(/[А-Яа-яЁё]/g)?.length ?? 0;
      return cyr / letters < 0.5 ? `доля кириллицы < 50% (${Math.round((cyr / letters) * 100)}%)` : null;
    },
  },
  { id: "V9-sourcepath", severity: "error", check: (c) => (c.sourcePath.trim().length === 0 ? "пустой sourcePath" : null) },
];

export function validateChunk(chunk: KnowledgeChunk): Violation[] {
  const out: Violation[] = [];
  for (const crit of TEXT_CRITERIA) {
    const msg = crit.check(chunk);
    if (msg) out.push({ criterion: crit.id, severity: crit.severity, chunkId: chunk.id, message: msg });
  }
  return out;
}

// Счётчик динамический (как у audience) — без форса фиксированного числа.
export function validateSet(chunks: KnowledgeChunk[]): Violation[] {
  const out: Violation[] = [];
  const seen = new Set<string>();
  for (const c of chunks) {
    if (seen.has(c.id)) out.push({ criterion: "id-unique", severity: "error", chunkId: c.id, message: "дубль id" });
    seen.add(c.id);
    out.push(...validateChunk(c));
  }
  return out;
}

export function summarize(violations: Violation[]): { errors: number; warnings: number } {
  return {
    errors: violations.filter((v) => v.severity === "error").length,
    warnings: violations.filter((v) => v.severity === "warn").length,
  };
}