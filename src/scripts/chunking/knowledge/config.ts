// Пути и константы чанкера `knowledge` (FSD). Логика не хардкодит — берёт отсюда.
export const KNOWLEDGE_PATH = "docs/Facts:Case:Best/KNOWLEDGE.md";
export const SOURCE_KNOWLEDGE = "docs/Facts:Case:Best/KNOWLEDGE.md";

// Файл-справочник тем/ниш (whitelist для knowledge.topic). Передаётся модели целиком.
export const TOPIC_REFERENCE_PATH = "docs/Facts:Case:Best/TOPICS.md";

// Скользящее окно по словам (см. knowledgePlan.md §4).
export const BLOCK_MIN_WORDS = 300;
export const BLOCK_MAX_WORDS = 600;
export const BLOCK_TARGET_WORDS = 500;

// Перекрытие ~12–15% хвоста предыдущего блока → в начало следующего.
export const OVERLAP_RATIO = 0.12;
export const OVERLAP_WORDS = Math.round(BLOCK_TARGET_WORDS * OVERLAP_RATIO);

// Версия промпта/правил заполнения knowledge — пишется в Chunk.llmPromptVersion.
export const KNOWLEDGE_LLM_PROMPT_VERSION = "knowledge-llm-v1";

// Канонический набор тем (whitelist). Должен совпадать с TOPIC_REFERENCE_PATH;
// LLM возвращает одну из них или null. Используется и как подсказка модели, и как
// критерий валидации (не хардкодим в логике).
export const KNOWLEDGE_TOPICS = [
  "контентные сайты",
  "монетизация",
  "обучение",
  "трафик",
  "делегирование",
  "предпринимательство",
  "реинвестирование",
  "личный бренд",
] as const;

export type KnowledgeTopic = (typeof KNOWLEDGE_TOPICS)[number];