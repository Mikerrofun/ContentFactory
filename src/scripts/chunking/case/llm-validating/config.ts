// Промпт и допустимые значения для `case.fearClosed`. Справочник — целиком.
import type { ChatMessage } from "../../lib/llm";

export const FEAR_REFERENCE_PATH = "docs/Info_ForGeneration/Markers/fear_markers.md";

// 7 страхов аудитории (см. llmContent.md §1).
export const FEAR_VALUES = [1, 2, 3, 4, 5, 6, 7] as const;

export const CASE_SYSTEM_PROMPT = [
  "Ты — аналитик контента. Определяешь, какие страхи аудитории закрывает кейс.",
  "Отвечай СТРОГО одним JSON-объектом, без markdown и пояснений.",
  "Формат: {\"fearClosed\": [номера страхов 1..7]}.",
  "Пустой массив [] — если кейс не закрывает ни один страх.",
  "Не выдумывай номера вне 1..7 и не дублируй их.",
].join("\n");

export function buildCaseMessages(text: string, reference: string): ChatMessage[] {
  const user = [
    "Справочник «Маркеры закрытия страхов» (используй его как критерии):",
    reference,
    "",
    "Кейс:",
    text,
    "",
    "Вопрос: какие из 7 страхов закрывает этот кейс? Верни массив номеров 1..7 (без дублей).",
  ].join("\n");
  return [
    { role: "system", content: CASE_SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}