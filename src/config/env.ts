// Централизованная конфигурация (env-валидация через zod).
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY_EMBEDING: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  EMBEDDING_MODEL: z.string().default("qwen/qwen3-embedding-8b"),
  EMBEDDING_DIM: z.coerce.number().default(4096),
  EMBEDDING_INPUT_TYPE: z.string().default("search_document"),
  OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
  LLM_MODEL: z.string().default("baidu/ernie-5.5-flash-preview:free"),
  LLM_FALLBACK_MODEL: z.string().default("z-ai/glm-5.3-flash"),
  LLM_TEMPERATURE: z.coerce.number().default(0),
  LLM_CONCURRENCY: z.coerce.number().int().positive().default(3),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid env:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment variables");
}

export const config = parsed.data;