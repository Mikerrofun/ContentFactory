import { readFileSync } from "node:fs";
import { clean } from "../lib/clean";
import { writeChunkTree, writeReport } from "../lib/fs";
import type { AudienceChunk, AudienceEmotion, Report } from "../lib/types";
import {
  AUDIENCE_PATH,
  SOURCE_AUDIENCE,
  emotionForSection,
} from "./config";
import type { RawPhrase } from "./types";

const H1_RE = /^#\s/;
const H2_RE = /^##\s/;
const H3_RE = /^###\s/;
const ITEM_RE = /^-\s+(.*)$/;
const HR_RE = /^-{3,}$/;
const QUOTE_RE = /^(?:>|\|>)/;

// clean() не де-экранирует `*`, `>`, `` ` `` (только `#-~[]_` и `\`).
// В AUDIENCE.md они встречаются (\* 192, \> 1, \` 2) — снимаем локально,
// чтобы в фразы не попадали остаточные backslash-escape.
function deescapeExtra(text: string): string {
  return text.replace(/\\\*/g, "*").replace(/\\>/g, ">").replace(/\\`/g, "`");
}

export function parsePhrases(raw: string): RawPhrase[] {
  const { text } = clean(raw);
  const out: RawPhrase[] = [];
  let emotion: AudienceEmotion = "прочее";
  let cur: string | null = null;
  let open = false;

  const flush = () => {
    if (cur !== null) {
      const phrase = deescapeExtra(cur).trim();
      if (phrase) out.push({ text: phrase, emotion });
    }
    cur = null;
    open = false;
  };

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line === "") {
      flush();
      continue;
    }

    if (H3_RE.test(line)) {
      flush();
      continue;
    }
    if (H2_RE.test(line)) {
      flush();
      emotion = emotionForSection(line.replace(H2_RE, "").trim());
      continue;
    }
    if (H1_RE.test(line)) {
      flush();
      continue;
    }

    const item = line.match(ITEM_RE);
    if (item) {
      flush();
      cur = item[1] ?? "";
      open = true;
      continue;
    }

    if (HR_RE.test(line) || QUOTE_RE.test(line)) {
      flush();
      continue;
    }

    // Продолжение многострочной фразы (переносы внутри одного абзаца).
    if (open && cur !== null) {
      cur = cur ? `${cur} ${line}` : line;
    }
  }
  flush();
  return out;
}

function toChunk(
  phrase: RawPhrase,
  id: string,
): AudienceChunk {
  return {
    id,
    type: "audience",
    text: phrase.text,
    emotion: phrase.emotion,
    fearType: null,
    sourcePath: SOURCE_AUDIENCE,
    embedding: null,
  };
}

export function runAudienceChunker(): { chunks: AudienceChunk[]; report: Report } {
  const phrases = parsePhrases(readFileSync(AUDIENCE_PATH, "utf8"));
  const chunks = phrases.map((p, i) => toChunk(p, `AUD-${String(i + 1).padStart(4, "0")}`));

  const bySource: Record<string, number> = {};
  for (const c of chunks) bySource[c.sourcePath] = (bySource[c.sourcePath] ?? 0) + 1;

  const report: Report = { type: "audience", total: chunks.length, bySource, warnings: [] };
  writeChunkTree("audience", chunks);
  writeReport("audience", report);
  return { chunks, report };
}