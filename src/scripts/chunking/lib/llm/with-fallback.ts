import { withRetry } from "../../../../shared/lib/net/with-retry";
import { LLM_ATTEMPTS, LLM_BACKOFF_MS, LLM_FALLBACK_MODEL, LLM_MODEL } from "./config";
import { chatJSON } from "./openrouter";
import type { ChatJSONOptions, ChatJSONResult, ChatMessage } from "./types";

export type ChatJSONFn = (messages: ChatMessage[], opts?: ChatJSONOptions) => Promise<unknown>;

const defaultPrimary: ChatJSONFn = (messages, opts) => chatJSON(messages, { ...opts, model: LLM_MODEL });
const defaultFallback: ChatJSONFn = (messages, opts) => chatJSON(messages, { ...opts, model: LLM_FALLBACK_MODEL });

export interface FallbackDeps {
  primary?: ChatJSONFn;
  fallback?: ChatJSONFn;
}

// Основная модель через withRetry(3) → фоллбэк без ретраев → throw наверх.
// Ретраи и фоллбэк — только на ошибках транспорта/JSON; невалидный ответ
// (валидация схемы) обрабатывает вызывающий run.ts.
export async function chatJSONWithFallback<T = unknown>(
  messages: ChatMessage[],
  opts: ChatJSONOptions = {},
  deps: FallbackDeps = {},
): Promise<ChatJSONResult<T>> {
  const primary = deps.primary ?? defaultPrimary;
  const fallback = deps.fallback ?? defaultFallback;

  try {
    const data = (await withRetry(() => primary(messages, opts), {
      attempts: LLM_ATTEMPTS,
      backoffMs: LLM_BACKOFF_MS,
    })) as T;
    return { data, model: LLM_MODEL, fallback: false };
  } catch (err) {
    console.error(`[llm] основная модель ${LLM_MODEL} недоступна: ${(err as Error).message}`);
    const data = (await fallback(messages, opts)) as T;
    return { data, model: LLM_FALLBACK_MODEL, fallback: true };
  }
}