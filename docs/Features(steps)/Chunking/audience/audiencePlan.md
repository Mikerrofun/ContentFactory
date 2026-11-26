# Audience Chunking — план реализации (planDemands)

## Основные файлы для изучения

- `docs/Features(steps)/Chunking/case/casePlan.md`, `case/CaseFeature.md` — эталон per-type.
- `src/scripts/chunking/case/chunk.ts`, `case/load.ts`, `case/validate.ts`, `case/config.ts` — шаблон.
- `src/scripts/chunking/lib/clean/`, `lib/fs/`, `lib/types.ts` — общий слой.
- `src/shared/lib/net/with-retry.ts` — общий ретрай.
- `src/scripts/chunking/chunk.ts`, `load.ts`, `validate-chunks.ts` — диспетчеры/гейт.
- `prisma/schema.prisma` — модель `Chunk` (type, text, emotion, fearType, sourcePath, embedding).
- `docs/Facts:Case:Best/AUDIENCE.md` — источник (банк фраз, секции `\##`, items `\-`).
- `docs/Info_ForGeneration/Markers/fear_markers.md` — 7 страхов (для будущего `fearType`).

## Цель

Нарезать банк живого языка аудитории из `AUDIENCE.md` в чанки `type = audience` по принципу **1 фраза = 1 чанк**, JSON в `data/chunks/audience/`, валидация, загрузка в БД. `fearType`/`embedding` — позже (LLM/векторы).

## Схема чанка `audience`

| Поле | Тип | Источник / смысл |
|---|---|---|
| `id` | string PK | `AUD-0001…` (последовательный) |
| `type` | `audience` | — |
| `text` | string | одна фраза (дословно), очищенная; он же в вектор |
| `emotion` | string\|null | категория из секции (детерминированно) |
| `fearType` | number\|null | 1–7 для страхов, заполнит LLM позже; сейчас `null` |
| `sourcePath` | string | путь к AUDIENCE.md |
| `embedding` | null | векторы — отдельная итерация |
| `addedAt` | string | ISO |

Без `depletion`/`cooldown` (эталон). Без `sourceUrl`.

## emotion — маппинг из секций

| Секция | emotion |
|---|---|
| 1) Страхи | страх |
| 2) Возражения | возражение |
| 3) Желания | желание |
| 4) Триггеры доверия | триггер |
| 5) Ограничения | ограничение |
| Как использовать | инструкция |
| 7) Лексика «жизни в ноль» | лексика |
| 8) Скрытые страхи | скрытый страх |
| 9) Частые возражения | возражение |
| 10) Успокоители | успокоитель |
| 11) Красные слова | красное слово |
| 12) Мини-CTA | CTA |
| 13) / Добавления (порции 2/3/последняя) | прочее |

## Задачи (флоу, без кода)

1. **Типы (FSD).** В `lib/types.ts` — `AudienceChunk`; `ChunkType` уже содержит `audience`.
2. **Конфиг.** `audience/config.ts`: `AUDIENCE_PATH`, `SOURCE_AUDIENCE`, `SECTION_EMOTION` (маппинг секция→emotion), `FEAR_SECTIONS` (страхи/скрытые страхи).
3. **`audience/chunk.ts`.** Флоу: `readFileSync(AUDIENCE.md)` → `clean()` → парс секций (`\## …`) → внутри секции items `\- ` (многострочные — join переносов) → 1 `AudienceChunk` на фразу (`id` = `AUD-####` по порядку, `emotion` из `SECTION_EMOTION`, `fearType` = null) → `writeChunkTree("audience", …)` + `writeReport`. Ссылки: `lib/clean`, `lib/fs`, `lib/types`, `audience/config`.
4. **`audience/validate.ts`.** Критерии V1–V9 + структура (уникальность `id`; счётчик = фактическое число фраз, не фиксируем). Ссылки: `lib/clean`, `lib/types`.
5. **`audience/load.ts`.** `readChunkTree<AudienceChunk>("audience")` → dry-run/`--apply` → `withRetry(prisma.chunk.upsert)` с `{ type:"audience", text, emotion, sourcePath }` (без `canPublish`/`depletion`; `fearType`/`embedding` — null). Ссылки: `shared/lib/net/with-retry`, `db/prisma`, `lib/fs`.
6. **Диспетчеры.** `chunk.ts` — ветка `audience`; `load.ts` — `audience: () => import("./audience/load")`; `validate-chunks.ts` — `RUNNERS.audience`.
7. **Комментарии** — только на неочевидном (многострочные фразы, маппинг emotion).

## Валидации (`audience/validate.ts`)

- V1 остаточное экранирование — error
- V2 HTML/Markdown-теги — error
- V3 двойные пробелы — warn
- V4 пробелы в конце строки — warn
- V5 пустой `text` — error
- V6 `emotion ∈ {страх,возражение,желание,триггер,ограничение,инструкция,лексика,скрытый страх,успокоитель,красное слово,CTA,прочее}` или null — error
- V7 U+FFFD — error
- V8 доля кириллицы < 50% — warn
- V9 пустой `sourcePath` — error
- Структура: уникальность `id`.

## Load: отличие от fact/case/best

- Общее: `withRetry`, dry-run/`--apply`, `readChunkTree`, `prisma.chunk.upsert`.
- Upsert-данные: `{ type:"audience", text, emotion, sourcePath }` — без `canPublish`/`depletion`; `fearType`/`embedding` при создании `null`.

## Тесты (минимальные, в конце)

- Смоук: `chunk audience` → JSON в `data/chunks/audience`; `validate-chunks audience` → 0 errors.
- Юнит: 1 секция → N фраз, у каждой непустой `text` и заполненный `emotion`.
- Load dry-run: печатает план, не пишет.

## Ограничения

- `fearType` и `embedding` — `null` (LLM/векторы позже).
- Много фраз — это норма (атомарность для RAG).
- Векторы — отдельная итерация.