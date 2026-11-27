// Промпт и допустимые значения для `audience.fearType`.
import type { ChatMessage } from "../../lib/llm";

export const FEAR_REFERENCE_PATH = "docs/Info_ForGeneration/Markers/fear_markers.md";

// 7 страхов аудитории (нумерация совпадает с case.fearClosed).
export const FEAR_VALUES = [1, 2, 3, 4, 5, 6, 7] as const;

export const AUDIENCE_SYSTEM_PROMPT = [
  "Ты — аналитик контента. Определяешь, какой страх аудитории выражает фраза.",
  "Отвечай СТРОГО одним JSON-объектом, без markdown и пояснений.",
  "Формат: {\"fearType\": число 1..7 | null}.",
  "null — если фраза не выражает ни один из 7 страхов.",
].join("\n");

export function buildAudienceMessages(text: string, reference: string): ChatMessage[] {
  const user = [
    "Справочник «Маркеры закрытия страхов» (7 страхов, критерии):",
    reference,
    "",
    "Фраза аудитории:",
    text,
    "",
    "Вопрос: какой страх (1..7) выражает фраза? Верни число или null.",
  ].join("\n");
  return [
    { role: "system", content: AUDIENCE_SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}