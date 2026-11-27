// Общие типы LLM-клиента (без БД/ФС — чистые структуры).

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatJSONOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

// Ответ модели + фактически использованная модель (основная или фоллбэк).
export interface ChatJSONResult<T> {
  data: T;
  model: string;
  fallback: boolean;
}

// Отчёт по типу LLM-заполнения (data/llm-content/<type>.md).
export interface LlmTypeReport {
  type: string;
  field: string;
  total: number;
  filled: number;
  skipped: number;
  failed: number;
  models: Record<string, number>;
  failedIds: string[];
  dryRun: boolean;
}