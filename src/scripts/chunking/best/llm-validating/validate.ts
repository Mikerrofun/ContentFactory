// Чистая валидация ответа модели для `best` (sScheme / closingType / markers).
import type { BestMarkers } from "../../lib/types";
import { CLOSING_VALUES, SCHEME_VALUES } from "./config";
import type { BestField, BestValidation } from "./types";

const SCHEMES = new Set<string>(SCHEME_VALUES);
const CLOSINGS = new Set<string>(CLOSING_VALUES);
const MARKER_KEYS: ReadonlyArray<keyof BestMarkers> = ["fear", "bio", "emotional", "anti"];
const MAX_MARKERS_PER_KEY = 20;

// Возраст в словаре задан шаблоном «N лет (30..80)», поэтому конкретное
// «30 лет» / «в 40» — валидный био-маркер, хотя дословно в словаре его нет.
const AGE_RE = /^(\d{2})\s*(?:лет|года|год)$/;
const AGE_SHORT_RE = /^в\s*(\d{2})$/;

function markerAllowed(key: keyof BestMarkers, value: string, dict: string): boolean {
  const lower = value.toLowerCase();
  if (dict.includes(lower)) return true;
  // Словарь задаёт формы («на пенсии», «N лет»), модель возвращает лемму
  // («пенсия») — принимаем по 5-символьной основе, чтобы не терять валидное.
  if (lower.length >= 5 && dict.includes(lower.slice(0, 5))) return true;
  if (key !== "bio") return false;
  const age = value.match(AGE_RE) ?? value.match(AGE_SHORT_RE);
  if (!age) return false;
  const n = Number(age[1]);
  return n >= 30 && n <= 80;
}

function validateMarkers(raw: unknown, dicts: Record<keyof BestMarkers, string>): { value?: BestMarkers; error?: string } {
  if (typeof raw !== "object" || raw === null) return { error: "markers не объект" };
  const out = {} as BestMarkers;
  for (const key of MARKER_KEYS) {
    const list = (raw as Record<string, unknown>)[key];
    if (!Array.isArray(list)) return { error: `markers.${key} не массив` };
    if (list.length > MAX_MARKERS_PER_KEY) return { error: `markers.${key}: слишком много (${list.length})` };
    const dict = dicts[key].toLowerCase();
    const seen = new Set<string>();
    for (const item of list) {
      if (typeof item !== "string" || item.trim().length === 0) return { error: `markers.${key}: пустое значение` };
      const value = item.trim();
      if (seen.has(value)) return { error: `markers.${key}: дубль «${value}»` };
      if (!markerAllowed(key, value, dict)) return { error: `markers.${key}: «${value}» нет в словаре` };
      seen.add(value);
    }
    out[key] = [...seen];
  }
  return { value: out };
}

export function validateBestAnswer(
  answer: unknown,
  dicts: Record<keyof BestMarkers, string>,
): BestValidation {
  if (typeof answer !== "object" || answer === null) return { ok: false, errors: { sScheme: "ответ не объект" } };
  const a = answer as Record<string, unknown>;
  const errors: Partial<Record<BestField, string>> = {};

  const sScheme = a.sScheme ?? null;
  if (sScheme !== null && (typeof sScheme !== "string" || !SCHEMES.has(sScheme))) {
    errors.sScheme = `sScheme вне S1..S15 (${String(sScheme)})`;
  }

  const closingType = a.closingType ?? null;
  if (closingType !== null && (typeof closingType !== "string" || !CLOSINGS.has(closingType))) {
    errors.closingType = `closingType вне списка (${String(closingType)})`;
  }

  const markers = validateMarkers(a.markers, dicts);
  if (markers.error) errors.markers = markers.error;

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      sScheme: sScheme as string | null,
      closingType: closingType as string | null,
      markers: markers.value as BestMarkers,
    },
  };
}