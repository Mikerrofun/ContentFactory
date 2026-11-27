// Чистая валидация ответа модели для `case.fearClosed`.
import { FEAR_VALUES } from "./config";
import type { CaseValidation } from "./types";

const ALLOWED = new Set<number>(FEAR_VALUES);

export function validateCaseAnswer(answer: unknown): CaseValidation {
  if (typeof answer !== "object" || answer === null) return { ok: false, error: "ответ не объект" };
  const raw = (answer as { fearClosed?: unknown }).fearClosed;
  if (!Array.isArray(raw)) return { ok: false, error: "fearClosed не массив" };

  const out: number[] = [];
  for (const item of raw) {
    if (typeof item !== "number" || !Number.isInteger(item)) return { ok: false, error: `fearClosed: не число (${String(item)})` };
    if (!ALLOWED.has(item)) return { ok: false, error: `fearClosed: значение вне 1..7 (${item})` };
    if (!out.includes(item)) out.push(item);
  }
  out.sort((a, b) => a - b);
  return { ok: true, value: { fearClosed: out } };
}