// Промпт и допустимые значения для `knowledge` (facts / topic). Справочник тем — целиком.
import type { ChatMessage } from "../../lib/llm";
import { KNOWLEDGE_TOPICS } from "../config";

export { TOPIC_REFERENCE_PATH } from "../config";
export { KNOWLEDGE_LLM_PROMPT_VERSION } from "../config";

export const FACTS_MIN = 3;
export const FACTS_MAX = 7;

export const KNOWLEDGE_SYSTEM_PROMPT = [
  "Ты — аналитик контента. Извлекаешь атомарные факты и тему из текста.",
  "Отвечай СТРОГО одним JSON-объектом, без markdown и пояснений.",
  `Формат: {"facts": [строки], "topic": "тема" | null}.`,
  `facts — ${FACTS_MIN}–${FACTS_MAX} атомарных фактов (каждый — одна законченная мысль, без воды).`,
  "topic — ровно одна тема из справочника ниже; null, если текст не подходит ни к одной теме.",
  "Не выдумывай темы вне справочника и не дублируй факты.",
].join("\n");

export function buildKnowledgeMessages(text: string, reference: string): ChatMessage[] {
  const user = [
    "Справочник тем/ниш (используй его как whitelist для topic):",
    reference,
    "",
    "Текст:",
    text,
    "",
    `Извлеки ${FACTS_MIN}–${FACTS_MAX} атомарных фактов и одну тему из справочника (или null).`,
  ].join("\n");
  return [
    { role: "system", content: KNOWLEDGE_SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}

// Множество допустимых тем для валидации (канонический список из config).
export const ALLOWED_TOPICS: ReadonlySet<string> = new Set(KNOWLEDGE_TOPICS);