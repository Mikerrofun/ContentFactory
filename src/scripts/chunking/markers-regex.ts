// Regex-проход по маркерам: tsx src/scripts/chunking/markers-regex.ts [best] [--apply] [--force] [--limit N]
// Заполняет `best.markers` детерминированно по 4 словарям — там, где LLM вернула пустоту.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { prisma } from "../../db/prisma";
import { buildMarkerRules, detectMarkers, isEmptyMarkers, type MarkerDicts } from "./lib/markers";
import { REGEX_PROMPT_VERSION, writeLlmReport } from "./lib/llm";
import { MARKER_REFERENCES } from "./best/llm-validating/config";
import { getChunksMissingMarkers, updateMarkers } from "./best/llm-validating/store";

const APPLY = process.argv.includes("--apply");
const FORCE = process.argv.includes("--force");

function readFlagValue(argv: string[], name: string): number {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === name) return Number(argv[i + 1] ?? 0);
    if (argv[i].startsWith(`${name}=`)) return Number(argv[i].slice(name.length + 1));
  }
  return 0;
}
const LIMIT = readFlagValue(process.argv.slice(2), "--limit");

function loadDicts(): MarkerDicts {
  return {
    fear: readFileSync(MARKER_REFERENCES.fear, "utf8"),
    bio: readFileSync(MARKER_REFERENCES.bio, "utf8"),
    emotional: readFileSync(MARKER_REFERENCES.emotional, "utf8"),
    anti: readFileSync(MARKER_REFERENCES.anti, "utf8"),
  };
}

async function main() {
  const rules = buildMarkerRules(loadDicts());
  console.log(`[markers] правил извлечено: ${rules.length}`);
  console.log(`[markers] режим: ${APPLY ? "APPLY (запись в БД)" : "dry-run"}${FORCE ? " + force" : ""}`);

  let rows = await getChunksMissingMarkers(FORCE);
  if (LIMIT) rows = rows.slice(0, LIMIT);
  if (rows.length === 0) {
    console.error("[markers] нет чанков с пустыми маркерами");
    return;
  }

  let filled = 0;
  let stillEmpty = 0;
  const emptyIds: string[] = [];
  const counts = { fear: 0, bio: 0, emotional: 0, anti: 0 };

  for (const row of rows) {
    const detected = detectMarkers(row.text, rules);
    if (isEmptyMarkers(detected)) {
      stillEmpty += 1;
      emptyIds.push(row.id);
      console.log(`[markers] ${row.id} → пусто (нет маркеров в тексте)`);
      continue;
    }
    if (APPLY) await updateMarkers(row.id, detected, { model: "regex", version: REGEX_PROMPT_VERSION });
    filled += 1;
    counts.fear += detected.fear.length;
    counts.bio += detected.bio.length;
    counts.emotional += detected.emotional.length;
    counts.anti += detected.anti.length;
    console.log(
      `[markers] ${row.id} → fear=${detected.fear.length} bio=${detected.bio.length} emotional=${detected.emotional.length} anti=${detected.anti.length}`,
    );
  }

  writeLlmReport({
    type: "best-markers",
    field: "markers (regex)",
    total: rows.length,
    filled,
    skipped: 0,
    failed: stillEmpty,
    models: { regex: filled },
    failedIds: emptyIds,
    dryRun: !APPLY,
  });
  console.log(`[markers] итого: всего=${rows.length} заполнено=${filled} пусто=${stillEmpty}`);
  console.log(`[markers] маркеров: fear=${counts.fear} bio=${counts.bio} emotional=${counts.emotional} anti=${counts.anti}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());