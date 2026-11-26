# Swipe Chunking — план реализации (planDemands)

## Основные файлы для изучения

- `docs/Features(steps)/Chunking/case/casePlan.md`, `case/CaseFeature.md` — эталон per-type.
- `src/scripts/chunking/case/chunk.ts`, `case/load.ts`, `case/validate.ts`, `case/config.ts` — шаблон.
- `src/scripts/chunking/lib/clean/`, `lib/fs/`, `lib/types.ts` — общий слой.
- `src/shared/lib/net/with-retry.ts` — общий ретрай.
- `src/scripts/chunking/chunk.ts`, `load.ts`, `validate-chunks.ts` — диспетчеры/гейт.
- `prisma/schema.prisma` — модель `Chunk` (type, text, pillar, format, whyItWorks, structure, patternsToBorrow, doNotCopy, sourcePath, embedding).
- `docs/Facts:Case:Best/SWIPES.md` — источник (56 карточек, 5 секций, `• KEY:` поля).

## Цель

Нарезать 56 карточек-морф-шаблонов из `SWIPES.md` в чанки `type = swipe` (1 карточка = 1 чанк, текст+разбор вместе), JSON в `data/chunks/swipe/`, валидация, загрузка в БД. Векторы — позже.

## Схема чанка `swipe`

| Поле | Тип | Источник / смысл |
|---|---|---|
| `id` | string PK | `SW-0001…` (последовательный) |
| `type` | `swipe` | — |
| `text` | string | вся карточка (META+класс+теги+оригинал+разбор), очищенная; он же в вектор |
| `pillar` | string\|null | `PILLAR` (HUMAN/METHOD/PROOF/TRUST) |
| `format` | string\|null | `FORMAT` |
| `sourcePath` | string | путь к SWIPES.md |
| `whyItWorks` | string[]\|null | `WHY_IT_WORKS` (bullets) |
| `structure` | string[]\|null | `STRUCTURE` (скелет) |
| `patternsToBorrow` | string[]\|null | `PATTERNS_TO_BORROW` |
| `doNotCopy` | string[]\|null | `DO_NOT_COPY` |
| `embedding` | null | векторы — отдельная итерация |
| `addedAt` | string | ISO |

Без `depletion`/`cooldown` (эталон). Без `sourceUrl`.

## Задачи (флоу, без кода)

1. **Типы (FSD).** В `lib/types.ts` — `SwipeChunk`; `ChunkType` уже содержит `swipe`.
2. **Конфиг.** `swipe/config.ts`: `SWIPES_PATH`, `SOURCE_SWIPE`, `EXPECTED_SWIPE_COUNT = 56`, `SWIPE_FIELDS` (whitelist `• KEY:`), `PILLAR_VALUES`.
3. **`swipe/chunk.ts`.** Флоу: `readFileSync(SWIPES.md)` → `clean()` → парс карточек (граница `**ЕДИНАЯ КАРТОЧКА ПОСТА**`; поля `• KEY:`; многострочные значения — join; секция 5 парсится на `WHY_IT_WORKS/STRUCTURE/PATTERNS_TO_BORROW/DO_NOT_COPY` bullets) → `text` = вся карточка → `SwipeChunk[]` (`id` = `SW-####`) → `writeChunkTree("swipe", …)` + `writeReport`. Ссылки: `lib/clean`, `lib/fs`, `lib/types`, `swipe/config`.
4. **`swipe/validate.ts`.** Критерии V1–V9 + `pillar ∈ {…}|null` + структура (уникальность `id`, счётчик = 56). Ссылки: `lib/clean`, `lib/types`.
5. **`swipe/load.ts`.** `readChunkTree<SwipeChunk>("swipe")` → dry-run/`--apply` → `withRetry(prisma.chunk.upsert)` с `{ type:"swipe", text, pillar, format, sourcePath, whyItWorks, structure, patternsToBorrow, doNotCopy }` (без `canPublish`/`depletion`; `embedding` null). Ссылки: `shared/lib/net/with-retry`, `db/prisma`, `lib/fs`.
6. **Диспетчеры.** `chunk.ts` — ветка `swipe`; `load.ts` — `swipe: () => import("./swipe/load")`; `validate-chunks.ts` — `RUNNERS.swipe`.
7. **Комментарии** — только на неочевидном (структура карточки, парс секции 5).

## Валидации (`swipe/validate.ts`)

- V1 остаточное экранирование — error
- V2 HTML/Markdown-теги — error
- V3 двойные пробелы — warn
- V4 пробелы в конце строки — warn
- V5 пустой `text` — error
- V6 `pillar ∈ {PROOF,METHOD,TRUST,HUMAN}` или null — error
- V7 U+FFFD — error
- V8 доля кириллицы < 50% — warn
- V9 пустой `sourcePath` — error
- Структура: уникальность `id`; счётчик = 56.

## Load: отличие от fact/case/best/audience

- Общее: `withRetry`, dry-run/`--apply`, `readChunkTree`, `prisma.chunk.upsert`.
- Upsert-данные: `{ type:"swipe", text, pillar, format, sourcePath, whyItWorks, structure, patternsToBorrow, doNotCopy }` — без `canPublish`/`depletion`; `embedding` null.

## Тесты (минимальные, в конце)

- Смоук: `chunk swipe` → 56 JSON; `validate-chunks swipe` → 0 errors.
- Юнит: 1 карточка → непустой `text`, заполненные `pillar`/`format`, непустой `structure`.
- Load dry-run: печатает план, не пишет.

## Ограничения

- `embedding` — `null` (векторы позже).
- 1 карточка = 1 чанк (текст+разбор вместе).
- Векторы — отдельная итерация.