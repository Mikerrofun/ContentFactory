import { RetryableError, isRetryableStatus } from "../../../../shared/lib/net/with-retry";
import { LLM_MAX_TOKENS, LLM_TEMPERATURE } from "./config";
import type { ChatJSONOptions, ChatMessage } from "./types";

interface OpenRouterChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
}

// Снимаем markdown-обёртку, если модель всё же вернула ```json … ```.
function stripFences(text: string): string {
  const t = text.trim();
  if (!t.startsWith("```")) return t;
  return t.replace(/^```[a-zA-Z]*\s*/, "").replace(/```\s*$/, "").trim();
}

// Клиент OpenRouter (OpenAI-совместимый): строгий JSON-ответ.
export async function chatJSON<T = unknown>(messages: ChatMessage[], opts: ChatJSONOptions = {}): Promise<T> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY не задан");

  const baseUrl = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model,
      messages,
      temperature: opts.temperature ?? LLM_TEMPERATURE,
      max_tokens: opts.maxTokens ?? LLM_MAX_TOKENS,
      response_format: { type: "json_object" },
    }),
    signal: opts.signal,
  });

  if (!res.ok) {
    const status = res.status;
    if (isRetryableStatus(status)) throw new RetryableError(`OpenRouter ${status}`, status);
    const body = await res.text().catch(() => "");
    throw new Error(`OpenRouter ${status}: ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as OpenRouterChatResponse;
  if (json.error) throw new Error(`OpenRouter error: ${json.error.message ?? "unknown"}`);

  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenRouter: пустой ответ модели (проверь max_tokens/лимиты модели)");

  try {
    return JSON.parse(stripFences(content)) as T;
  } catch {
    throw new Error(`OpenRouter: ответ не JSON: ${content.slice(0, 200)}`);
  }
}