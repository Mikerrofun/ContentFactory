import { prisma } from "../../../db/prisma";
import { readChunkTree } from "../lib/fs";
import { withRetry } from "../../../shared/lib/net/with-retry";
import type { CaseChunk } from "../lib/types";

const APPLY = process.argv.includes("--apply");

async function main() {
  const chunks = readChunkTree<CaseChunk>("case");
  if (chunks.length === 0) {
    console.error("[load] нет чанков в data/chunks/case — сначала запусти чанкер");
    process.exit(1);
  }

  console.log(`[load] ${chunks.length} чанков case`);
  console.log(`[load] режим: ${APPLY ? "APPLY (запись в БД)" : "dry-run"}`);
  if (!APPLY) {
    for (const c of chunks.slice(0, 5)) console.log(`  ${c.id} [${c.pillar ?? "—"}] ${c.text.slice(0, 60)}…`);
    console.log(`  … и ещё ${Math.max(0, chunks.length - 5)}`);
    return;
  }

  let done = 0;
  for (const c of chunks) {
    const data = { type: "case" as const, text: c.text, topic: c.topic, pillar: c.pillar, sourcePath: c.sourcePath };
    await withRetry(
      () =>
        prisma.chunk.upsert({
          where: { id: c.id },
          update: data,
          create: { id: c.id, ...data, depletion: 1.0 },
        }),
      { attempts: 3 },
    );
    done += 1;
    if (done % 10 === 0) console.log(`[load] ${done}/${chunks.length}`);
  }
  console.log(`[load] готово: ${done}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());