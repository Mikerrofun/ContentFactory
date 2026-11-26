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

// Единый чанк `case` (см. docs/Features(steps)/Chunking/case/casePlan.md).
export interface CaseChunk {
  id: string;
  type: "case";
  text: string;
  topic: string | null;
  pillar: string | null;
  sourcePath: string;
  fearClosed: string[] | null;
  depletion: number;
  cooldownUntil: string | null;
  embedding: null;
  addedAt: string;
}

export interface Report {
  type: ChunkType;
  total: number;
  bySource: Record<string, number>;
  warnings: string[];
}

// Результат прогона чанкера.
export interface ChunkRunResult<T = FactChunk> {
  chunks: T[];
  report: Report;
}