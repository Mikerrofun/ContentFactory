# Best Chunking — план реализации (planDemands)

## Основные файлы для изучения

- `docs/Features(steps)/Chunking/case/casePlan.md` и `case/CaseFeature.md` — эталон per-type.
- `docs/Features(steps)/Chunking/facts/FactsFeature.md` — ещё один образец.
- `src/scripts/chunking/case/chunk.ts`, `case/load.ts`, `case/validate.ts`, `case/config.ts` — шаблон «чанкер + загрузчик + валидатор + конфиг».
- `src/scripts/chunking/lib/clean/`, `lib/fs/`, `lib/types.ts` — общий слой.
- `src/shared/lib/net/with-retry.ts` — общий ретрай.
- `src/scripts/chunking/chunk.ts`, `load.ts`, `validate-chunks.ts` — диспетчеры и гейт.
- `prisma/schema.prisma` — enum `ChunkType` (переименовать `voice` → `best`), модель `Chunk`.
- `docs/Facts:Case:Best/BEST.md` — источник (65 постов, **один вид заголовков** `## **POST …**`, нормализован до нарезки).
- `docs/Info_ForGeneration/VOICE_FINGERPRINT.md`, `docs/Facts:Case:Best/VOICE.md` — что такое S-схемы/финалы (для будущего LLM-прохода).

## Цель

Нарезать 65 постов-эталонов из `BEST.md` в чанки `type = best`, JSON в `data/chunks/best/`, валидация, загрузка в БД. Векторы и LLM-поля — позже.

## Схема чанка `best`

| Поле | Тип | Источник / смысл |
|---|---|---|
| `id` | string PK | `BEST-0001…` (последовательный) |
| `type` | `best` | — |
| `text` | string | тело поста (весь), очищенный; он же в вектор |
| `pillar` | string\|null | `Pillar/PILLAR` (есть у 4) |
| `format` | string\|null | `Формат` (есть у 11) |
| `sourcePath` | string | путь к BEST.md |
| `sScheme` | null | S-схема (S1–S15), заполнит LLM позже |
| `closingType` | null | тип финала, LLM позже |
| `markers` | null | fear/bio/emotional/anti, LLM позже |
| `embedding` | null | векторы — отдельная итерация |
| `addedAt` | string | ISO |

Без `depletion`/`cooldown` (эталон, не расходуется). Без `sourceUrl`. `platform/date/goal/context/successMetric` — внутри `text`.

## Переименование voice → best

- В `prisma/schema.prisma` enum `ChunkType`: `voice` → `best` (миграция).
- В `lib/types.ts` union `ChunkType`: `voice` → `best`; добавить `BestChunk`.
- Код/диспетчеры используют `best`. В БД voice ещё нет — переименование безопасно.

## Задачи (флоу, без кода)

1. **Типы (FSD).** В `lib/types.ts` — `BestChunk`, обновить `ChunkType` (`voice`→`best`).
2. **Конфиг.** `best/config.ts`: `BEST_PATH`, `SOURCE_BEST`, `EXPECTED_BEST_COUNT = 65`, `BEST_FIELDS` (whitelist метаданных), `PILLAR_VALUES`.
3. **`best/chunk.ts`.** Флоу: `readFileSync(BEST.md)` → `clean()` → парс постов (заголовок одного вида `^## \*\*POST (VK-P-\d+) --- (title)\*\*`; `id` = `BEST-####` по порядку; source-id `VK-P-####` уникален, но id чанка всё равно последовательный) → собрать `text` (метаданные + тело поста) → `pillar`/`format` из метаданных → `BestChunk[]` → `writeChunkTree("best", …)` + `writeReport`. Ссылки: `lib/clean`, `lib/fs`, `lib/types`, `best/config`.
4. **`best/validate.ts`.** Критерии V1–V9 + структура (уникальность `id`, счётчик = 65). Ссылки: `lib/clean` (`RESIDUAL_ESCAPE`), `lib/types`. Типы — в файле типов.
5. **`best/load.ts`.** `readChunkTree<BestChunk>("best")` → dry-run/`--apply` → `withRetry(prisma.chunk.upsert)` с `{ type:"best", text, pillar, format, sourcePath }` (без `canPublish`, без `depletion`). Ссылки: `shared/lib/net/with-retry`, `db/prisma`, `lib/fs`.
6. **Диспетчеры.** `chunk.ts` — ветка `best`; `load.ts` — `best: () => import("./best/load")`; `validate-chunks.ts` — `RUNNERS.best`.
7. **Комментарии** — только на неочевидном (4 вида заголовков, неполные метаданные).

## Валидации (`best/validate.ts`)

- V1 остаточное экранирование — error
- V2 HTML/Markdown-теги — error
- V3 двойные пробелы — warn
- V4 пробелы в конце строки — warn
- V5 пустой `text` — error
- V6 `pillar ∈ {PROOF,METHOD,TRUST,HUMAN}` или null — error
- V7 U+FFFD — error
- V8 доля кириллицы < 50% — warn
- V9 пустой `sourcePath` — error
- Структура: уникальность `id`; счётчик = 65.

## Load: отличие от fact/case

- Общее: `withRetry`, dry-run/`--apply`, `readChunkTree`, `prisma.chunk.upsert`.
- Upsert-данные: `{ type:"best", text, pillar, format, sourcePath }` — без `canPublish`, без `depletion`; `sScheme/closingType/markers/embedding` при создании `null`.

## Тесты (минимальные, в конце)

- Смоук: `chunk best` → 65 JSON; `validate-chunks best` → 0 errors.
- Юнит: парс 1 поста даёт непустой `text` и `id = BEST-0001`.
- Load dry-run: печатает план, не пишет.

## Ограничения

- `sScheme`, `closingType`, `markers`, `embedding` — `null` (LLM/векторы позже).
- Заголовки в источнике нормализованы к одному виду `## **POST …**`; id уникальны (дубли устранены, 65 постов).
- Векторы — отдельная итерация.