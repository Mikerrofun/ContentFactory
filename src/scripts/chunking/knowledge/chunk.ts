import { readFileSync } from "node:fs";
import { clean } from "../lib/clean";
import { writeChunkTree, writeReport } from "../lib/fs";
import type { KnowledgeChunk, Report } from "../lib/types";
import {
  BLOCK_MAX_WORDS,
  BLOCK_MIN_WORDS,
  BLOCK_TARGET_WORDS,
  KNOWLEDGE_PATH,
  OVERLAP_WORDS,
  SOURCE_KNOWLEDGE,
} from "./config";
import type { WordToken } from "./types";

const SENTENCE_END_RE = /[.!?…]["»')\]]*$/;

// Текст → токены слов с флагами конца предложения/абзаца (приоритетные точки разрыва).
export function tokenize(text: string): WordToken[] {
  const tokens: WordToken[] = [];
  const paragraphs = text.split(/\n{2,}/);
  paragraphs.forEach((para, pIdx) => {
    const words = para.trim().split(/\s+/).filter(Boolean);
    const lastPara = pIdx === paragraphs.length - 1;
    words.forEach((word, wIdx) => {
      tokens.push({
        word,
        endSentence: SENTENCE_END_RE.test(word),
        endParagraph: lastPara ? false : wIdx === words.length - 1,
      });
    });
  });
  return tokens;
}

// Ближайшая к цели граница предложения/абзаца в диапазоне [minEnd, maxEnd] (индексы включительно).
// Возвращает индекс токена-конца блока или null, если границ нет (режем по словам).
function findBoundary(tokens: WordToken[], minEnd: number, maxEnd: number, targetEnd: number): number | null {
  let best = -1;
  for (let i = minEnd; i <= maxEnd; i += 1) {
    const t = tokens[i];
    if (!t) continue;
    if (t.endSentence || t.endParagraph) {
      if (best === -1 || Math.abs(i - targetEnd) < Math.abs(best - targetEnd)) best = i;
    }
  }
  return best === -1 ? null : best;
}

// Детерминированная нарезка скользящим окном по словам с перекрытием.
// Одинаковый вход → одинаковые блоки.
export function chunkByWindow(tokens: WordToken[]): string[] {
  const n = tokens.length;
  const blocks: string[] = [];
  let start = 0;

  while (start < n) {
    const targetEnd = start + BLOCK_TARGET_WORDS - 1;
    let end: number;

    if (targetEnd >= n - 1) {
      end = n; // хвост меньше цели — забираем остаток
    } else {
      const minEnd = start + BLOCK_MIN_WORDS - 1;
      const maxEnd = Math.min(start + BLOCK_MAX_WORDS - 1, n - 1);
      const boundary = findBoundary(tokens, minEnd, maxEnd, targetEnd);
      // Нет границы предложения в окне (одиночное длинное предложение) — режем по словам у цели.
      end = boundary === null ? Math.min(start + BLOCK_TARGET_WORDS, n) : boundary + 1;
    }

    blocks.push(
      tokens
        .slice(start, end)
        .map((t) => t.word)
        .join(" "),
    );

    if (end >= n) break;
    // Перекрытие: хвост прошлого блока (OVERLAP_WORDS слов) дословно попадает в начало следующего.
    const step = Math.max(1, end - start - OVERLAP_WORDS);
    start += step;
  }

  return blocks;
}

function toChunk(id: string, text: string): KnowledgeChunk {
  return {
    id,
    type: "knowledge",
    text,
    topic: null,
    facts: null,
    factEmbeddings: null,
    factsUsed: null,
    sourcePath: SOURCE_KNOWLEDGE,
    depletion: 0, // 0 = свежий (см. knowledgePlan.md §2/§10)
    embedding: null,
  };
}

export function runKnowledgeChunker(): { chunks: KnowledgeChunk[]; report: Report } {
  const { text } = clean(readFileSync(KNOWLEDGE_PATH, "utf8"));
  const blocks = chunkByWindow(tokenize(text));
  const chunks = blocks.map((b, i) => toChunk(`KNOW-${String(i + 1).padStart(4, "0")}`, b));

  const bySource: Record<string, number> = {};
  for (const c of chunks) bySource[c.sourcePath] = (bySource[c.sourcePath] ?? 0) + 1;

  const report: Report = { type: "knowledge", total: chunks.length, bySource, warnings: [] };
  writeChunkTree("knowledge", chunks);
  writeReport("knowledge", report);
  return { chunks, report };
}