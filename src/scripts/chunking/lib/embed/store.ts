import { prisma } from "../../../../db/prisma";
import type { EmbeddingRow } from "./types";

// Вектор передаём строкой "[...]" и кастуем к ::vector в SQL.
function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

export async function getChunksNeedingEmbedding(type: string): Promise<EmbeddingRow[]> {
  const rows = await prisma.$queryRaw<EmbeddingRow[]>`
    SELECT id, text, "embeddingHash"
    FROM "Chunk"
    WHERE type = ${type}::"ChunkType"
    ORDER BY id
  `;
  return rows;
}

export async function upsertEmbedding(
  chunkId: string,
  vector: number[],
  hash: string,
  model: string,
  dims: number,
): Promise<void> {
  const literal = toVectorLiteral(vector);
  await prisma.$executeRaw`
    UPDATE "Chunk"
    SET "chunkEmbedding" = ${literal}::vector,
        "embeddingHash" = ${hash},
        "embeddingModel" = ${model},
        "embeddingDims" = ${dims}
    WHERE id = ${chunkId}
  `;
}

export async function countChunks(type: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) AS count FROM "Chunk" WHERE type = ${type}::"ChunkType"
  `;
  return Number(rows[0]?.count ?? 0);
}

export async function getEmbeddingRow(chunkId: string): Promise<EmbeddingRow | null> {
  const rows = await prisma.$queryRaw<EmbeddingRow[]>`
    SELECT id, text, "embeddingHash" FROM "Chunk" WHERE id = ${chunkId}
  `;
  return rows[0] ?? null;
}

export async function getVectorLength(chunkId: string): Promise<number | null> {
  const rows = await prisma.$queryRaw<Array<{ len: number | null }>>`
    SELECT vector_dims("chunkEmbedding") AS len FROM "Chunk" WHERE id = ${chunkId}
  `;
  return rows[0]?.len ?? null;
}