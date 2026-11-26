// Пути и константы чанкера `case` (FSD). Логика не хардкодит — берёт отсюда.
export const CASE_PATH = "docs/Facts:Case:Best/CASE.md";
export const SOURCE_CASE = "docs/Facts:Case:Best/CASE.md";

// В CASE.md 68 карточек (CASE_0001…CASE_0069, без 0067).
export const EXPECTED_CASE_COUNT = 68;

// Поля-маркеры карточки (whitelist). Только они открывают новое поле;
// строки с «:» вне списка — продолжение текущего поля.
export const CASE_FIELDS = [
  "source_type",
  "source_link",
  "source_proof",
  "date",
  "topic",
  "pillar",
  "START (контекст)",
  "GOAL (цель)",
  "ACTIONS (что делал)",
  "RESULT (что получил)",
  "KEY INSIGHT (1--2 вывода)",
  "REPEATABLE STEP (что читателю повторить)",
] as const;

export type CaseField = (typeof CASE_FIELDS)[number];

// Порядок склейки контентных секций в `text` (он же уходит в вектор).
export const TEXT_ORDER: CaseField[] = [
  "START (контекст)",
  "GOAL (цель)",
  "ACTIONS (что делал)",
  "RESULT (что получил)",
  "KEY INSIGHT (1--2 вывода)",
  "REPEATABLE STEP (что читателю повторить)",
];

export const PILLAR_VALUES = ["PROOF", "METHOD", "TRUST", "HUMAN"] as const;