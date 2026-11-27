// Чистая валидация ответа модели для `audience.fearType`.
import { FEAR_VALUES } from "./config";
import type { AudienceValidation } from "./types";

const ALLOWED = new Set<number>(FEAR_VALUES);

export function validateAudienceAnswer(answer: unknown): AudienceValidation {
  if (typeof answer !== "object" || answer === null) return { ok: false, error: "ответ не объект" };
  const raw = (answer as { fearType?: unknown }).fearType;
  if (raw === null || raw === undefined) return { ok: true, value: { fearType: null } };
  if (typeof raw !== "number" || !Number.isInteger(raw)) return { ok: false, error: `fearType не целое (${String(raw)})` };
  if (!ALLOWED.has(raw)) return { ok: false, error: `fearType вне 1..7 (${raw})` };
  return { ok: true, value: { fearType: raw } };
}