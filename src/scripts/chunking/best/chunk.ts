import { readFileSync } from "node:fs";
import { clean } from "../lib/clean";
import { writeChunkTree, writeReport } from "../lib/fs";
import type { BestChunk, Report } from "../lib/types";
import {
  BEST_PATH,
  SOURCE_BEST,
  HEADER_RE,
  BODY_MARKER_RE,
  FORMAT_LABEL_RE,
  PLACEHOLDER_RE,
  PILLAR_VALUES,
} from "./config";

interface RawPost {
  sourceId: string;
  block: string;
}

// Markdown hard-break: одиночный `\` в конце строки → перенос.
function stripHardBreaks(text: string): string {
  return text.replace(/\\\n/g, "\n");
}

export function parsePosts(raw: string): RawPost[] {
  const { text } = clean(raw);
  const posts: RawPost[] = [];
  let cur: RawPost | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (cur) {
      cur.block = stripHardBreaks(buf.join("\n").trim());
      posts.push(cur);
    }
    cur = null;
    buf = [];
  };

  for (const line of text.split("\n")) {
    const header = line.match(HEADER_RE);
    if (header) {
      flush();
      cur = { sourceId: header[1], block: "" };
      continue;
    }
    if (!cur) continue; // всё до первого поста
    buf.push(line);
  }
  flush();
  return posts;
}

function firstPillarToken(text: string): string | null {
  for (const p of PILLAR_VALUES) {
    if (new RegExp(`\\b${p}\\b`).test(text)) return p;
  }
  return null;
}

// Шапка метаданных — всё до маркера тела (`Текст поста:` / `RAW TEXT:` / `Текст:`).
function splitHeaderBody(block: string): { header: string; body: string } {
  const lines = block.split("\n");
  const idx = lines.findIndex((l) => BODY_MARKER_RE.test(l.trim()));
  if (idx === -1) return { header: block, body: "" };
  return { header: lines.slice(0, idx).join("\n"), body: lines.slice(idx + 1).join("\n") };
}

// pillar по метке в шапке: широкая (Пиллар/Pillar/PILLAR, в т.ч. «Пиллар (основной):»,
// «Пиллар(ы):», «Группа/пиллар:», «PILLAR / INTENT:»). Значение может быть на
// следующей строке — берём окно. Плейсхолдер → пропускаем (ищем дальше).
function pillarFromLabel(header: string): string | null {
  const lines = header.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (!/пиллар/i.test(lines[i])) continue;
    const window = lines.slice(i, i + 3).join("\n");
    if (PLACEHOLDER_RE.test(window)) continue;
    const tok = firstPillarToken(window);
    if (tok) return tok;
  }
  return null;
}

// pillar по полю `Цель:` (есть в части схем метаданных).
function pillarFromGoal(header: string): string | null {
  const goal = header.match(/^Цель\s*:\s*(.*)$/im)?.[1] ?? "";
  if (!goal) return null;
  const tok = firstPillarToken(goal);
  if (tok) return tok;
  if (/деятельност|делу|результат|кейс|подтвержд|доказат/i.test(goal)) return "PROOF";
  if (/риск|предупрежд|границ|не подойд|ценност|этик|миссия|обман|скам/i.test(goal)) return "TRUST";
  if (/личн|с собой|личности|семь|жизн|рефлекси|мышлен/i.test(goal)) return "HUMAN";
  if (/интерес|интриг|вовлеч|активац|продолжени|метод|рамк|стратег/i.test(goal)) return "METHOD";
  return null;
}

// Эвристика по телу/тегам, когда явной метки и `Цель` нет.
function pillarFromBody(header: string, body: string): string | null {
  const t = `${header}\n${body}`.toLowerCase();
  const score: Record<string, number> = { PROOF: 0, METHOD: 0, TRUST: 0, HUMAN: 0 };
  const add = (k: string, re: RegExp) => {
    const m = t.match(re);
    if (m) score[k] += m.length;
  };
  add("PROOF", /результат|заработ|доход|ученик|кейс|миллион|\d+\s*(?:тыс|млн|руб)|скрин|отчёт/gi);
  add("METHOD", /метод|рамк|стратег|план|инсайт|ошибк|инструмент|провер|действие|принцип|почему|миф|на самом деле/gi);
  add("TRUST", /ценност|границ|не делаю|миссия|этик|обман|скам|риск|предупрежд|не подойд/gi);
  add("HUMAN", /семь|сын|дочь|жена|муж|мама|папа|из простых|личная история|друг|жизнь/gi);
  let best: string | null = null;
  let bv = 0;
  for (const k of ["PROOF", "METHOD", "TRUST", "HUMAN"]) {
    if (score[k] > bv) {
      bv = score[k];
      best = k;
    }
  }
  return best;
}

function extractPillar(block: string): string | null {
  const { header, body } = splitHeaderBody(block);
  return pillarFromLabel(header) ?? pillarFromGoal(header) ?? pillarFromBody(header, body);
}

// pillar строго один из 4: если в блоке нет однозначных данных — дефолт HUMAN.
export function pillarForBlock(block: string): string {
  return extractPillar(block) ?? "HUMAN";
}

// format: значение строки `Формат:` (или следующей, если пусто). Плейсхолдер → null.
function extractFormat(block: string): string | null {
  const lines = block.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(FORMAT_LABEL_RE);
    if (!m) continue;
    let val = (m[1] ?? "").trim();
    if (!val && i + 1 < lines.length) val = lines[i + 1].trim();
    if (!val || PLACEHOLDER_RE.test(val)) return null;
    return val;
  }
  return null;
}

function toChunk(post: RawPost, id: string, addedAt: string): BestChunk {
  return {
    id,
    type: "best",
    text: post.block,
    pillar: pillarForBlock(post.block),
    format: extractFormat(post.block),
    sourcePath: SOURCE_BEST,
    sScheme: null,
    closingType: null,
    markers: null,
    embedding: null,
    addedAt,
  };
}

export function runBestChunker(): { chunks: BestChunk[]; report: Report } {
  const addedAt = new Date().toISOString();
  const posts = parsePosts(readFileSync(BEST_PATH, "utf8"));
  const chunks = posts.map((p, i) => toChunk(p, `BEST-${String(i + 1).padStart(4, "0")}`, addedAt));

  const bySource: Record<string, number> = {};
  for (const c of chunks) bySource[c.sourcePath] = (bySource[c.sourcePath] ?? 0) + 1;

  const report: Report = { type: "best", total: chunks.length, bySource, warnings: [] };
  writeChunkTree("best", chunks);
  writeReport("best", report);
  return { chunks, report };
}