// Общие типы чанкера. БД/ФС не знают — чистые структуры.

export type ChunkType = "knowledge" | "case" | "fact" | "voice" | "swipe" | "audience";

export type CanPublish = "yes" | "partial" | "no";

// Единый чанк `fact` (см. docs/Features(steps)/Chunking/facts/facts.md).
export interface FactChunk {
  id: string;
  type: "fact";
  text: string;
  canPublish: CanPublish;
  sourcePath: string;
  addedAt: string;
}

export interface Report {
  type: ChunkType;
  total: number;
  bySource: Record<string, number>;
  warnings: string[];
}

// Результат прогона чанкера.
export interface ChunkRunResult {
  chunks: FactChunk[];
  report: Report;
}