import type { CleanStats, RuleResult } from "./types";

export function subAll(text: string, pattern: RegExp, replacement: string): RuleResult {
  let count = 0;
  const out = text.replace(pattern, () => {
    count += 1;
    return replacement;
  });
  return { text: out, count };
}

export function subOnce(text: string, pattern: RegExp, replacement: string, label: string): RuleResult {
  const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
  const found = text.match(re)?.length ?? 0;
  if (found !== 1) throw new Error(`[clean] subOnce "${label}": ожидалось 1, найдено ${found}`);
  return { text: text.replace(pattern, replacement), count: 1 };
}

const DEESCAPE: Array<[string, RegExp, string]> = [
  ["deescape-dash", /\\-/g, "-"],
  ["deescape-hash", /\\#/g, "#"],
  ["deescape-tilde", /\\~/g, "~"],
  ["deescape-lbracket", /\\\[/g, "["],
  ["deescape-rbracket", /\\\]/g, "]"],
  ["deescape-underscore", /\\_/g, "_"],
  ["deescape-backslash", /\\\\/g, "\\"],
];

function normalize(raw: string): RuleResult {
  let text = raw;
  let count = 0;
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
    count += 1;
  }
  const steps: Array<[RegExp, string]> = [
    [/\r\n/g, "\n"],
    [/[ \t]+$/gm, ""],
    [/\n{3,}/g, "\n\n"],
    [/ {2,}/g, " "],
  ];
  for (const [pattern, replacement] of steps) {
    const res = subAll(text, pattern, replacement);
    text = res.text;
    count += res.count;
  }
  return { text: text.trim(), count };
}

export function clean(raw: string): { text: string; stats: CleanStats } {
  const stats: CleanStats = {};
  let text = raw;
  for (const [id, pattern, replacement] of DEESCAPE) {
    const res = subAll(text, pattern, replacement);
    text = res.text;
    if (res.count > 0) stats[id] = res.count;
  }
  const norm = normalize(text);
  if (norm.count > 0) stats.normalize = norm.count;
  return { text: norm.text, stats };
}

export const RESIDUAL_ESCAPE = /\\[#\-~\[\]]/;