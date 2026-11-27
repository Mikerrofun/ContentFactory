// Конфиг LLM-прохода. Модели/лимиты — из config/env, дубли не хардкодим.
import { config } from "../../../../config/env";

export const LLM_MODEL = config.LLM_MODEL;
export const LLM_FALLBACK_MODEL = config.LLM_FALLBACK_MODEL;
export const LLM_TEMPERATURE = config.LLM_TEMPERATURE;

// Сколько чанков обрабатываем параллельно. У :free-моделей жёсткий rate-limit,
// поэтому по умолчанию 3 (см. LLM_CONCURRENCY в env).
export const LLM_CONCURRENCY = config.LLM_CONCURRENCY;

// Основная модель: 3 попытки с бэкоффом; фоллбэк — без ретраев.
export const LLM_ATTEMPTS = 3;
export const LLM_BACKOFF_MS = 1500;

// Повтор запроса при невалидном JSON/ответе (тем же промптом).
export const VALIDATE_ATTEMPTS = 3;

// Запас на reasoning: у :free-моделей reasoning может съесть весь бюджет,
// поэтому max_tokens берём с запасом (best — ещё больше, см. run.ts).
export const LLM_MAX_TOKENS = 6500;

// Версия промпта/правил заполнения — пишется в Chunk.llmPromptVersion.
export const LLM_PROMPT_VERSION = "llm-content-v1";
export const REGEX_PROMPT_VERSION = "regex-markers-v1";