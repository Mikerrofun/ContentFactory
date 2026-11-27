// Детерминированный поиск маркеров по 4 словарям (regex/substring).
// Смысл: там, где LLM вернула пустые массивы, маркеры считаются формально.
import type { BestMarkers } from "../types";

export type MarkerKey = keyof BestMarkers;

export interface MarkerDicts {
  fear: string;
  bio: string;
  emotional: string;
  anti: string;
}

export interface MarkerRule {
  key: MarkerKey;
  label: string;
  re: RegExp;
  check?: (match: RegExpMatchArray) => boolean;
}

const MIN_PHRASE_LEN = 4;
export const MAX_MARKERS_PER_KEY = 20;

// Убираем пояснения в скобках, чтобы не вытаскивать «лет» из «(… + «лет»)».
function stripParens(line: string): string {
  return line.replace(/\([^)]*\)/g, " ");
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Числовые оговорки из словарей: возраст 30..80, зарплата ≤ 50.
function numberCheck(label: string): ((m: RegExpMatchArray) => boolean) | undefined {
  const l = label.toLowerCase();
  if (l.includes("зарплата") || l.includes("получал")) {
    return (m) => Number(m[1]) <= 50;
  }
  if (/^n лет$/.test(l) || l.includes("в n лет")) {
    return (m) => Number(m[1]) >= 30 && Number(m[1]) <= 80;
  }
  return undefined;
}

function compileRule(key: MarkerKey, phrase: string): MarkerRule | null {
  const trimmed = phrase.trim().replace(/\s+/g, " ");
  const label = trimmed.toLowerCase();
  if (label.length < MIN_PHRASE_LEN) return null;
  if (/[()…]/.test(label)) return null;

  const hasNumber = /\bN\b/.test(trimmed);
  const isSingleWord = !/\s/.test(label);

  // Однословные правила матчим по основе (супруга → супруг+супругу),
  // иначе словарь ловит только точную форму. Числовые шаблоны — строго.
  if (isSingleWord && !hasNumber) {
    const stem = label.length >= 5 ? label.slice(0, label.length - 2) : label;
    const re = new RegExp(`(?<![а-яёa-z0-9])${escapeRe(stem)}`);
    return { key, label, re, check: numberCheck(label) };
  }

  const body = escapeRe(trimmed).replace(/\bN\b/g, "(\\d{1,3})");
  const re = new RegExp(`(?<![а-яёa-z0-9])${body}(?![а-яёa-z0-9])`);
  return { key, label, re, check: numberCheck(label) };
}

// Разбор одного файла-словаря: строки-буллеты, «…»-цитаты, пропуск исключений.
function parseDict(key: MarkerKey, raw: string): MarkerRule[] {
  const rules: MarkerRule[] = [];
  let inCode = false;
  let skipSection = false;

  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("```")) {
      inCode = !inCode;
      continue;
    }
    if (inCode || line === "") continue;

    if (/^#{1,6}\s/.test(line)) {
      skipSection = false;
      continue;
    }
    // Блок «ИСКЛЮЧЕНЫ как не обычные» — это антипримеры, не маркеры.
    if (/исключ/i.test(line) && !/^[-*]\s/.test(line)) {
      skipSection = true;
      continue;
    }
    if (skipSection) continue;
    if (!/^[-*]\s/.test(line)) continue;

    const cleaned = stripParens(line);
    const quoted = cleaned.match(/«([^»]+)»/g) ?? [];
    if (quoted.length > 0) {
      for (const q of quoted) {
        const rule = compileRule(key, q.replace(/^«|»$/g, ""));
        if (rule) rules.push(rule);
      }
      continue;
    }
    // Строки вида «- N лет …» без кавычек.
    const bare = cleaned.replace(/^[-*]\s*/, "").trim();
    const rule = compileRule(key, bare);
    if (rule) rules.push(rule);
  }
  return rules;
}

export function buildMarkerRules(dicts: MarkerDicts): MarkerRule[] {
  return (Object.keys(dicts) as MarkerKey[]).flatMap((key) => parseDict(key, dicts[key]));
}

export function detectMarkers(text: string, rules: MarkerRule[]): BestMarkers {
  const lower = text.toLowerCase();
  const out: BestMarkers = { fear: [], bio: [], emotional: [], anti: [] };
  for (const rule of rules) {
    if (out[rule.key].length >= MAX_MARKERS_PER_KEY) continue;
    if (out[rule.key].includes(rule.label)) continue;
    const m = lower.match(rule.re);
    if (!m) continue;
    if (rule.check && !rule.check(m)) continue;
    out[rule.key].push(rule.label);
  }
  return out;
}

export function isEmptyMarkers(markers: unknown): boolean {
  if (typeof markers !== "object" || markers === null) return true;
  const m = markers as Record<string, unknown>;
  return (["fear", "bio", "emotional", "anti"] as MarkerKey[]).every(
    (k) => !Array.isArray(m[k]) || (m[k] as unknown[]).length === 0,
  );
}