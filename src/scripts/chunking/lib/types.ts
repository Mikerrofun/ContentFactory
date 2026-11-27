// Общие типы чанкера. БД/ФС не знают — чистые структуры.

export type ChunkType = "knowledge" | "case" | "fact" | "best" | "swipe" | "audience";

// Типы, готовые к эмбеддингу/нарезке (без knowledge — ещё не нарезан).
export const CHUNK_TYPES = ["fact", "case", "best", "audience", "swipe"] as const satisfies readonly ChunkType[];

export type CanPublish = "yes" | "partial" | "no";

// Единый чанк `fact` (см. docs/Features(steps)/Chunking/facts/facts.md).
export interface FactChunk {
  id: string;
  type: "fact";
  text: string;
  canPublish: CanPublish;
  sourcePath: string;
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
}

// Единый чанк `best` (см. docs/Features(steps)/Chunking/best/bestPlan.md).
export interface BestChunk {
  id: string;
  type: "best";
  text: string;
  pillar: string | null;
  format: string | null;
  sourcePath: string;
  sScheme: null;
  closingType: null;
  markers: null;
  embedding: null;
}

// Эмоция-категория чанка `audience` (детерминированно из секции AUDIENCE.md).
export type AudienceEmotion =
  | "страх"
  | "возражение"
  | "желание"
  | "триггер"
  | "ограничение"
  | "инструкция"
  | "лексика"
  | "скрытый страх"
  | "успокоитель"
  | "красное слово"
  | "CTA"
  | "прочее";

// Единый чанк `audience` (см. docs/Features(steps)/Chunking/audience/audiencePlan.md).
// 1 фраза = 1 чанк. fearType/embedding — отдельные итерации (пока null).
export interface AudienceChunk {
  id: string;
  type: "audience";
  text: string;
  emotion: AudienceEmotion | null;
  fearType: number | null;
  sourcePath: string;
  embedding: null;
}

// Единый чанк `swipe` (см. docs/Features(steps)/Chunking/swipe/swipePlan.md).
// 1 карточка-морф-шаблон = 1 чанк (текст+разбор вместе). embedding — позже.
export interface SwipeChunk {
  id: string;
  type: "swipe";
  text: string;
  pillar: string | null;
  format: string | null;
  sourcePath: string;
  whyItWorks: string[] | null;
  structure: string[] | null;
  patternsToBorrow: string[] | null;
  doNotCopy: string[] | null;
  embedding: null;
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