// Типы ответа LLM для `case.fearClosed` (в файле типов, не в логике).

export interface CaseLLMAnswer {
  fearClosed?: unknown;
}

export interface CaseFill {
  fearClosed: number[];
}

export type CaseValidation = { ok: true; value: CaseFill } | { ok: false; error: string };

// Строка-чанк для LLM-прогона (id + текст).
export interface LlmChunkRow {
  id: string;
  text: string;
}

export interface CaseRunOptions {
  apply: boolean;
  force: boolean;
  probe?: number;
  limit?: number;
}

export interface CaseRunResult {
  total: number;
  filled: number;
  skipped: number;
  failed: number;
  failedIds: string[];
  models: Record<string, number>;
  dryRun: boolean;
}

export type FillOutcome = { ok: true; value: CaseFill; model: string } | { ok: false; error: string };