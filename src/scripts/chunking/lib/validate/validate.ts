import type { FactChunk } from "../types";
import { RESIDUAL_ESCAPE } from "../clean";
import type { Criterion, Violation } from "./types";

export const TEXT_CRITERIA: Criterion[] = [
  { id: "V1-residual-escape", severity: "error", check: (c) => (RESIDUAL_ESCAPE.test(c.text) ? "осталось экранирование markdown" : null) },
  { id: "V2-html-tags", severity: "error", check: (c) => (/<[^>]+>/.test(c.text) ? "HTML-тег в тексте" : null) },
  { id: "V3-double-space", severity: "warn", check: (c) => (/ {2,}/.test(c.text) ? "двойные пробелы" : null) },
  { id: "V4-trailing-space", severity: "warn", check: (c) => (/[ \t]+$/m.test(c.text) ? "пробелы в конце строки" : null) },
  { id: "V5-empty", severity: "error", check: (c) => (c.text.trim().length === 0 ? "пустой text" : null) },
  { id: "V6-canpublish", severity: "error", check: (c) => (["yes", "partial", "no"].includes(c.canPublish) ? null : `canPublish=${c.canPublish}`) },
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

export function validateChunk(chunk: FactChunk): Violation[] {
  const out: Violation[] = [];
  for (const crit of TEXT_CRITERIA) {
    const msg = crit.check(chunk);
    if (msg) out.push({ criterion: crit.id, severity: crit.severity, chunkId: chunk.id, message: msg });
  }
  return out;
}

export function validateSet(chunks: FactChunk[], expected?: { fact?: number; pf?: number }): Violation[] {
  const out: Violation[] = [];
  const seen = new Set<string>();
  for (const c of chunks) {
    if (seen.has(c.id)) out.push({ criterion: "id-unique", severity: "error", chunkId: c.id, message: "дубль id" });
    seen.add(c.id);
    out.push(...validateChunk(c));
  }
  const factCount = chunks.filter((c) => c.id.startsWith("F-")).length;
  const pfCount = chunks.filter((c) => c.id.startsWith("PF-")).length;
  if (expected?.fact !== undefined && factCount !== expected.fact) out.push({ criterion: "count-fact", severity: "error", message: `fact: ${factCount}, ожидалось ${expected.fact}` });
  if (expected?.pf !== undefined && pfCount !== expected.pf) out.push({ criterion: "count-pf", severity: "error", message: `PF: ${pfCount}, ожидалось ${expected.pf}` });
  return out;
}

export function summarize(violations: Violation[]): { errors: number; warnings: number } {
  return {
    errors: violations.filter((v) => v.severity === "error").length,
    warnings: violations.filter((v) => v.severity === "warn").length,
  };
}