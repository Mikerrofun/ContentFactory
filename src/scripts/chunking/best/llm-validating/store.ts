import { prisma } from "../../../../db/prisma";
import type { Prisma } from "../../../../generated/prisma/client";
import type { BestFill, LlmChunkRow } from "./types";

// Маркеры считаем заполненными, только если найден хотя бы один в любом из
// 4 словарей: объект с 4 пустыми массивами = «не заполнено».
export function hasNoMarkers(markers: unknown): boolean {
  if (typeof markers !== "object" || markers === null) return true;
  const m = markers as Record<string, unknown>;
  return ["fear", "bio", "emotional", "anti"].every((k) => !Array.isArray(m[k]) || m[k].length === 0);
}

// Чанки `best` с незаполненными полями (или все при --force).
export async function getChunksMissing(force: boolean): Promise<LlmChunkRow[]> {
  const rows = await prisma.chunk.findMany({
    where: { type: "best" },
    select: { id: true, text: true, sScheme: true, closingType: true, markers: true },
    orderBy: { id: "asc" },
  });
  return rows
    .filter((r) => force || r.sScheme === null || r.closingType === null || r.markers === null)
    .map((r) => ({ id: r.id, text: r.text }));
}

export async function updateBestFields(
  chunkId: string,
  fill: BestFill,
  meta: { model: string; version: string },
): Promise<void> {
  await prisma.chunk.update({
    where: { id: chunkId },
    data: {
      sScheme: fill.sScheme,
      closingType: fill.closingType,
      markers: fill.markers as unknown as Prisma.InputJsonValue,
      llmProcessedAt: new Date(),
      llmModel: meta.model,
      llmPromptVersion: meta.version,
    },
  });
}

// Чанки `best` с пустыми маркерами (null или 4 пустых массива) — для regex-прохода.
export async function getChunksMissingMarkers(force: boolean): Promise<LlmChunkRow[]> {
  const rows = await prisma.chunk.findMany({
    where: { type: "best" },
    select: { id: true, text: true, markers: true },
    orderBy: { id: "asc" },
  });
  return rows.filter((r) => force || hasNoMarkers(r.markers)).map((r) => ({ id: r.id, text: r.text }));
}

export async function updateMarkers(
  chunkId: string,
  markers: BestFill["markers"],
  meta: { model: string; version: string },
): Promise<void> {
  await prisma.chunk.update({
    where: { id: chunkId },
    data: {
      markers: markers as unknown as Prisma.InputJsonValue,
      llmProcessedAt: new Date(),
      llmModel: meta.model,
      llmPromptVersion: meta.version,
    },
  });
}