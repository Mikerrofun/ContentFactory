// Пути и константы чанкера `audience` (FSD). Логика не хардкодит — берёт отсюда.
import type { AudienceEmotion } from "../lib/types";

export const AUDIENCE_PATH = "docs/Facts:Case:Best/AUDIENCE.md";
export const SOURCE_AUDIENCE = "docs/Facts:Case:Best/AUDIENCE.md";

// Секция AUDIENCE.md (H2, текст после `## `) → emotion. Порядок важен:
// проверяем по ведущему номеру/ключу, первое совпадение выигрывает.
// `10)` не матчит `/^1\)/` (после `1` идёт `0`, а не `)`).
export const SECTION_EMOTION: ReadonlyArray<readonly [RegExp, AudienceEmotion]> = [
  [/^1\)/, "страх"],
  [/^2\)/, "возражение"],
  [/^3\)/, "желание"],
  [/^4\)/, "триггер"],
  [/^5\)/, "ограничение"],
  [/^Как использовать/, "инструкция"],
  [/^7\)/, "лексика"],
  [/^8\)/, "скрытый страх"],
  [/^9\)/, "возражение"],
  [/^10\)/, "успокоитель"],
  [/^11\)/, "красное слово"],
  [/^12\)/, "CTA"],
  [/^13[.)]/, "прочее"],
  [/^Добавления/, "прочее"],
  [/^Дополнение/, "прочее"],
];

// Секции-страхи (для будущего `fearType`): emotion ∈ FEAR_EMOTIONS.
export const FEAR_EMOTIONS: readonly AudienceEmotion[] = ["страх", "скрытый страх"];

export const DEFAULT_EMOTION: AudienceEmotion = "прочее";

export function emotionForSection(title: string): AudienceEmotion {
  for (const [re, emotion] of SECTION_EMOTION) {
    if (re.test(title)) return emotion;
  }
  return DEFAULT_EMOTION;
}

// Все допустимые значения emotion (для валидатора V6).
export const EMOTION_VALUES: readonly AudienceEmotion[] = [
  "страх",
  "возражение",
  "желание",
  "триггер",
  "ограничение",
  "инструкция",
  "лексика",
  "скрытый страх",
  "успокоитель",
  "красное слово",
  "CTA",
  "прочее",
];