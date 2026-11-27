// Типы ответа LLM для `audience.fearType`.

export interface AudienceLLMAnswer {
  fearType?: unknown;
}

export interface AudienceFill {
  fearType: number | null;
}

export type AudienceValidation = { ok: true; value: AudienceFill } | { ok: false; error: string };

// Строка-чанк для LLM-прогона (id + текст).
export interface LlmChunkRow {
  id: string;
  text: string;
}

export interface AudienceRunOptions {
  apply: boolean;
  force: boolean;
  probe?: number;
  limit?: number;
}

export interface AudienceRunResult {
  total: number;
  filled: number;
  skipped: number;
  failed: number;
  failedIds: string[];
  models: Record<string, number>;
  dryRun: boolean;
}

export type FillOutcome = { ok: true; value: AudienceFill; model: string } | { ok: false; error: string };