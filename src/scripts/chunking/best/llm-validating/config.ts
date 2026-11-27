// Промпт, справочники и допустимые значения для `best`.
import type { ChatMessage } from "../../lib/llm";

// Скелеты S1–S15 + CTA-паттерны. Передаём файл целиком (решение итерации).
export const VOICE_REFERENCE_PATH = "docs/Facts:Case:Best/VOICE.md";

// Промпт с VOICE.md + 4 словарями тяжёлый — запас по max_tokens.
export const BEST_MAX_TOKENS = 6500;

// 4 словаря маркеров — тоже целиком.
export const MARKER_REFERENCES = {
  fear: "docs/Info_ForGeneration/Markers/fear_markers.md",
  bio: "docs/Info_ForGeneration/Markers/biomarkers.md",
  emotional: "docs/Info_ForGeneration/Markers/emotional_markers.md",
  anti: "docs/Info_ForGeneration/Markers/anti_markers.md",
} as const;

// S-схемы из VOICE.md (§7).
export const SCHEME_VALUES = [
  "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8",
  "S9", "S10", "S11", "S12", "S13", "S14", "S15",
] as const;

// Типы финала. В docs определений не было — фиксируем здесь (используем и как
// whitelist, и как подсказку модели).
export const CLOSING_TYPES: ReadonlyArray<{ value: string; hint: string }> = [
  { value: "лестница", hint: "финал выстраивает ступени: шаг за шагом, каждый следующий следует из предыдущего" },
  { value: "факторы", hint: "финал перечисляет факторы/условия, из-за которых получилось (без пошаговой лестницы)" },
  { value: "мостик", hint: "финал-переход от боли/истории к простому решению или следующему шагу" },
  { value: "CTA", hint: "финал — один прямой призыв к действию (🔥 / вопрос без ответа / «сохраните» / опрос реакциями)" },
  { value: "арка", hint: "финал замыкает арку: возврат к крючку/началу, «круг замкнулся»" },
];

export const CLOSING_VALUES = CLOSING_TYPES.map((c) => c.value);

export const BEST_SYSTEM_PROMPT = [
  "Ты — аналитик контента. Разбираешь пост-эталон по структуре и маркерам.",
  "Отвечай СТРОГО одним JSON-объектом, без markdown и пояснений.",
  "Формат: {\"sScheme\": \"S1..S15\" | null, \"closingType\": \"лестница|факторы|мостик|CTA|арка\" | null, \"markers\": {\"fear\": [], \"bio\": [], \"emotional\": [], \"anti\": []}}.",
  "sScheme — код структурного шаблона из справочника (S1..S15); null, если не подходит ни один.",
  "closingType — тип финала из списка; null, если финала нет.",
  "markers — только те маркеры, которые реально встречаются в тексте поста, дословно как в словарях.",
  "Не выдумывай маркеры, которых нет в словарях, и не дублируй их.",
].join("\n");

export function buildBestMessages(text: string, reference: string, markersReference: string): ChatMessage[] {
  const user = [
    "Справочник S-схем и CTA (VOICE.md целиком):",
    reference,
    "",
    "Справочники маркеров (fear / bio / emotional / anti):",
    markersReference,
    "",
    "Типы финала (closingType):",
    ...CLOSING_TYPES.map((c) => `- ${c.value} — ${c.hint}`),
    "",
    "Пост-эталон:",
    text,
    "",
    "Заполни sScheme, closingType и markers по этому посту.",
  ].join("\n");
  return [
    { role: "system", content: BEST_SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}