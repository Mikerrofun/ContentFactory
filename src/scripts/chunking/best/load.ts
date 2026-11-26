import { prisma } from "../../../db/prisma";
import { readChunkTree } from "../lib/fs";
import { withRetry } from "../../../shared/lib/net/with-retry";
import type { BestChunk } from "../lib/types";

const APPLY = process.argv.includes("--apply");

async function main() {
  const chunks = readChunkTree<BestChunk>("best");
  if (chunks.length === 0) {
    console.error("[load] нет чанков в data/chunks/best — сначала запусти чанкер");
    process.exit(1);
  }

  console.log(`[load] ${chunks.length} чанков best`);
  console.log(`[load] режим: ${APPLY ? "APPLY (запись в БД)" : "dry-run"}`);
  if (!APPLY) {
    for (const c of chunks.slice(0, 5)) console.log(`  ${c.id} [${c.pillar ?? "—"}] ${c.text.slice(0, 60)}…`);
    console.log(`  … и ещё ${Math.max(0, chunks.length - 5)}`);
    return;
  }

  let done = 0;
  for (const c of chunks) {
    const data = { type: "best" as const, text: c.text, pillar: c.pillar, format: c.format, sourcePath: c.sourcePath };
    await withRetry(
      () =>
        prisma.chunk.upsert({
          where: { id: c.id },
          update: data,
          create: { id: c.id, ...data },
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