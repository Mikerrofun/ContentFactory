// Типы ответа LLM для `knowledge` (facts / topic) — в файле типов, не в логике.

export interface KnowledgeLLMAnswer {
  facts?: unknown;
  topic?: unknown;
}

export interface KnowledgeFill {
  facts: string[];
  topic: string | null;
}

export type KnowledgeValidation = { ok: true; value: KnowledgeFill } | { ok: false; error: string };

// Строка-чанк для LLM-прогона (id + текст).
export interface LlmChunkRow {
  id: string;
  text: string;
}

export interface KnowledgeRunOptions {
  apply: boolean;
  force: boolean;
  probe?: number;
  limit?: number;
}

export interface KnowledgeRunResult {
  total: number;
  filled: number;
  skipped: number;
  failed: number;
  failedIds: string[];
  models: Record<string, number>;
  dryRun: boolean;
}

export type FillOutcome = { ok: true; value: KnowledgeFill; model: string } | { ok: false; error: string };