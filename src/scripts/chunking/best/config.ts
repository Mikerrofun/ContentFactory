// Пути и константы чанкера `best` (FSD). Логика не хардкодит — берёт отсюда.
export const BEST_PATH = "docs/Facts:Case:Best/BEST.md";
export const SOURCE_BEST = "docs/Facts:Case:Best/BEST.md";

// В BEST.md 64 поста-эталона (VK-P-0001…0067 без 0016, 0029, 0035).
export const EXPECTED_BEST_COUNT = 64;

// Значения pillar (primary). Извлекаем первое enum-слово из строки-метки.
export const PILLAR_VALUES = ["PROOF", "METHOD", "TRUST", "HUMAN"] as const;

// Заголовок поста: `## **POST VK-P-#### …**`. source-id нужен только для отчёта.
export const HEADER_RE = /^##\s+\*\*POST\s+(VK-P-\d+)\b/;

// Граница метаданных и тела поста (для извлечения pillar/format только из шапки).
export const BODY_MARKER_RE = /^(?:Текст поста|RAW TEXT|Текст)\s*:\s*$/i;

// Метка формата.
export const FORMAT_LABEL_RE = /^Формат\s*:\s*(.*)$/i;

// Плейсхолдеры в метаданных (значение ещё не заполнено) → трактуем как отсутствие.
export const PLACEHOLDER_RE = /заполнить|не удалось|не извлеч|недоступен|TODO/i;