import { prisma } from "../../../../db/prisma";
import { FEAR_EMOTIONS } from "../config";
import type { LlmChunkRow } from "./types";

// Фразы-страхи с незаполненным fearType (или все при --force).
// fearType заполняем только у emotion ∈ {страх, скрытый страх}.
export async function getChunksMissing(force: boolean): Promise<LlmChunkRow[]> {
  const rows = await prisma.chunk.findMany({
    where: { type: "audience", emotion: { in: [...FEAR_EMOTIONS] } },
    select: { id: true, text: true, fearType: true },
    orderBy: { id: "asc" },
  });
  return rows.filter((r) => force || r.fearType === null).map((r) => ({ id: r.id, text: r.text }));
}

export async function updateFearType(
  chunkId: string,
  fearType: number | null,
  meta: { model: string; version: string },
): Promise<void> {
  await prisma.chunk.update({
    where: { id: chunkId },
    data: {
      fearType,
      llmProcessedAt: new Date(),
      llmModel: meta.model,
      llmPromptVersion: meta.version,
    },
  });
}