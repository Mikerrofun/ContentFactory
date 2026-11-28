import { prisma } from "../../../../db/prisma";
import type { Prisma } from "../../../../generated/prisma/client";
import type { KnowledgeFill, LlmChunkRow } from "./types";

// Чанки `knowledge` с незаполненным facts (или все при --force).
// Пустой facts (null) = ещё не прогонялось, повторно не спрашиваем.
export async function getChunksMissing(force: boolean): Promise<LlmChunkRow[]> {
  const rows = await prisma.chunk.findMany({
    where: { type: "knowledge" },
    select: { id: true, text: true, facts: true },
    orderBy: { id: "asc" },
  });
  return rows.filter((r) => force || r.facts === null).map((r) => ({ id: r.id, text: r.text }));
}

export async function updateKnowledgeFields(
  chunkId: string,
  fill: KnowledgeFill & { factEmbeddings: number[][] },
  meta: { model: string; version: string },
): Promise<void> {
  await prisma.chunk.update({
    where: { id: chunkId },
    data: {
      facts: fill.facts,
      factEmbeddings: fill.factEmbeddings as unknown as Prisma.InputJsonValue,
      topic: fill.topic,
      llmProcessedAt: new Date(),
      llmModel: meta.model,
      llmPromptVersion: meta.version,
    },
  });
}