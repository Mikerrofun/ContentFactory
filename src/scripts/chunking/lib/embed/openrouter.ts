import { RetryableError, isRetryableStatus } from "../../../../shared/lib/net/with-retry";
import type { EmbedRequest } from "./types";

interface OpenRouterEmbeddingResponse {
  data?: Array<{ embedding?: number[] }>;
  error?: { message?: string };
}

// Клиент эмбеддингов OpenRouter (OpenAI-совместимый, batch).
export async function embedBatch(texts: string[], req: EmbedRequest): Promise<number[][]> {
  const apiKey = process.env.OPENROUTER_API_KEY_EMBEDING;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY_EMBEDING не задан");

  const baseUrl = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
  const res = await fetch(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: req.model,
      input: texts,
      input_type: req.inputType,
      encoding_format: "float",
    }),
  });

  if (!res.ok) {
    const status = res.status;
    if (isRetryableStatus(status)) throw new RetryableError(`OpenRouter ${status}`, status);
    const body = await res.text().catch(() => "");
    throw new Error(`OpenRouter ${status}: ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as OpenRouterEmbeddingResponse;
  if (json.error) throw new Error(`OpenRouter error: ${json.error.message ?? "unknown"}`);
  const data = json.data;
  if (!data || data.length !== texts.length) {
    throw new Error(`OpenRouter: ожидалось ${texts.length} векторов, получено ${data?.length ?? 0}`);
  }
  return data.map((d) => {
    if (!d.embedding) throw new Error("OpenRouter: пустой embedding");
    return d.embedding;
  });
}