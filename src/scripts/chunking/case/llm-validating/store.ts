import { prisma } from "../../../../db/prisma";
import type { CaseFill, LlmChunkRow } from "./types";

// Чанки `case` с незаполненным fearClosed (или все при --force).
export async function getChunksMissing(force: boolean): Promise<LlmChunkRow[]> {
  const rows = await prisma.chunk.findMany({
    where: { type: "case" },
    select: { id: true, text: true, fearClosed: true },
    orderBy: { id: "asc" },
  });
  // Пустое значение (null или []) = уже прогонялось, повторно не спрашиваем.
  return rows.filter((r) => force || r.fearClosed === null).map((r) => ({ id: r.id, text: r.text }));
}

export async function updateFearClosed(
  chunkId: string,
  fill: CaseFill,
  meta: { model: string; version: string },
): Promise<void> {
  await prisma.chunk.update({
    where: { id: chunkId },
    data: {
      fearClosed: fill.fearClosed,
      llmProcessedAt: new Date(),
      llmModel: meta.model,
      llmPromptVersion: meta.version,
    },
  });
}