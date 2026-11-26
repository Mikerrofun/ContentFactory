// Пути и константы чанкера `swipe` (FSD). Логика не хардкодит — берёт отсюда.
export const SWIPES_PATH = "docs/Facts:Case:Best/SWIPES.md";
export const SOURCE_SWIPE = "docs/Facts:Case:Best/SWIPES.md";

// В SWIPES.md 56 карточек-морф-шаблонов (REF_ID TG-NONROMAN-0001…0056).
export const EXPECTED_SWIPE_COUNT = 56;

// Значения pillar (primary).
export const PILLAR_VALUES = ["PROOF", "METHOD", "TRUST", "HUMAN"] as const;

// Граница карточки — отдельная строка-маркер.
export const CARD_BOUNDARY = "**ЕДИНАЯ КАРТОЧКА ПОСТА**";

// Заголовки секций внутри карточки (`**1) META**` … `**5) …**`) — не поля.
export const SECTION_HEADER_RE = /^\*\*\d\)/;

// Маркер поля с двоеточием: `• KEY: value` (META/КЛАССИФИКАЦИЯ/ТЕГИ).
// name — всё до `:` (напр. `ТЕМА/НИША (1 строка)`), value — после.
export const COLON_MARKER_RE = /^•\s+(.+?):\s?(.*)$/;

// Маркер поля-блока: `• KEY (описание)` без двоеточия (TEXT + разбор секции 5).
export const PAREN_MARKER_RE = /^•\s+([A-Za-zА-Яа-яЁё_]+)\s*\(/;

// Whitelist канонических имён полей. Только известное имя открывает поле;
// строки с `•` вне списка — продолжение текущего поля.
export const SWIPE_FIELDS = [
  "REF_ID",
  "ORIG_REF_ID",
  "SOURCE",
  "PLATFORM",
  "DATE",
  "ТЕМА/НИША",
  "PILLAR",
  "FORMAT",
  "ANGLE",
  "ЦА",
  "ЦЕЛЬ ПОСТА",
  "CTA_TYPE",
  "ТЕГИ",
  "TEXT",
  "WHY_IT_WORKS",
  "STRUCTURE",
  "PATTERNS_TO_BORROW",
  "DO_NOT_COPY",
  "ROMAN_ADAPTATION_NOTE",
] as const;

export type SwipeField = (typeof SWIPE_FIELDS)[number];

// Однозначные поля: значение только на строке-маркере (без continuation).
export const SINGLE_LINE_FIELDS: readonly SwipeField[] = [
  "REF_ID",
  "ORIG_REF_ID",
  "SOURCE",
  "PLATFORM",
  "DATE",
  "PILLAR",
  "FORMAT",
];

// Поля разбора (секция 5), которые клеятся в массив буллетов `●`.
export const BULLET_FIELDS: readonly SwipeField[] = [
  "WHY_IT_WORKS",
  "PATTERNS_TO_BORROW",
  "DO_NOT_COPY",
  "ROMAN_ADAPTATION_NOTE",
];

// Поле скелета (секция 5) — построчный массив без `●`.
export const LINE_FIELD: SwipeField = "STRUCTURE";