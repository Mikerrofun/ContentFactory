# Case Chunking — план реализации (planDemands)

## Основные файлы для изучения

Перед работой прочитать:
- `docs/Features(steps)/Chunking/case/case.md` — разбор структуры CASE.md (этот же тип).
- `docs/Features(steps)/Chunking/facts/FactsFeature.md` — эталон реализации per-type (fact).
- `src/scripts/chunking/fact/chunk.ts`, `fact/load.ts`, `fact/validate.ts` — образец «чанкер + загрузчик + валидатор» на тип.
- `src/scripts/chunking/lib/clean/` — общая очистка (переиспользуем).
- `src/scripts/chunking/lib/fs/` — общий generic read/write дерева.
- `src/scripts/chunking/lib/types.ts` — общие типы.
- `src/shared/lib/net/with-retry.ts` — общий ретрай.
- `src/scripts/chunking/chunk.ts`, `load.ts`, `validate-chunks.ts` — диспетчеры и гейт.
- `prisma/schema.prisma` — модель `Chunk` (type, text, topic, pillar, sourcePath, fearClosed, depletion, cooldownUntil, embedding).
- `docs/Facts:Case:Best/CASE.md` — источник (68 кейсов, pillar проставлен).
- `docs/Info_ForGeneration/Markers/fear_markers.md` — 7 страхов для `fearClosed`.

## Цель

Нарезать 68 кейсов из `CASE.md` в чанки `type = case`, записать JSON в `data/chunks/case/`, провалидировать, загрузить в БД. Векторы — отдельная итерация (поле `embedding` пока пустое).

## Схема чанка `case`

| Поле | Тип | Источник / смысл |
|---|---|---|
| `id` | string PK | `CASE_0001…` из заголовка |
| `type` | `case` | — |
| `text` | string | весь кейс (START+GOAL+ACTIONS+RESULT+KEY INSIGHT+REPEATABLE STEP), очищенный; он же в вектор |
| `topic` | string\|null | `topic` — ниша/предмет (доп. метрика и контекст) |
| `pillar` | string\|null | `pillar` — тип поста (PROOF/METHOD/TRUST/HUMAN); у всех 68 проставлен |
| `sourcePath` | string | путь к CASE.md (источника достаточно) |
| `fearClosed` | string[]\|null | какие страхи (1–7) закрывает; заполнит LLM позже, сейчас `null` |
| `depletion` | number | `1.0` при создании → снижается по мере использования |
| `cooldownUntil` | string\|null | ставится при использовании (полный износ → таймер) |
| `embedding` | null | вектор, заполнится в итерации эмбеддингов |
| `addedAt` | string | ISO |

Убраны: `hero` (есть в тексте), `sourceUrl` (хватает `sourcePath`).

## fearClosed — подробно

7 страхов аудитории (из `fear_markers.md`): 1 «не справлюсь/не освою», 2 «обманут», 3 «впустую потрачу», 4 «нет времени», 5 «нет компьютера», 6 «поздно начинать», 7 «стыдно перед другими».
Зачем:
1. **Матчинг под тему/страх** — если тема поста про «поздно», тянем кейс с `fearClosed #6` (точнее косинуса).
2. **Метрика пригодности** — кейс без закрытых страхов = слабый кандидат в PROOF standalone.
3. **Приоритет в бандже** — кейсы с >1 закрытым страхом выше.
Заполнение: при индексации дешёвая LLM сверяет текст кейса со словарём `fear_markers` → проставляет `fearClosed[]`. Сейчас — `null`.

## Задачи (флоу, без кода)

1. **Типы (FSD).** В `lib/types.ts` добавить `CaseChunk`; при необходимости — `case/types.ts` для case-специфики. Типизация живёт в файлах типов, не в логике.
2. **Конфиг.** Пути/константы (`CASE_PATH`, `SOURCE_CASE`, `EXPECTED_CASE_COUNT = 68`) вынести в отдельный `case/config.ts` (FSD), не хардкодить в логике.
3. **`case/chunk.ts`.** Флоу: прочитать `CASE.md` → `clean()` → распарсить карточки (старт с первого `## CASE_`; поля по whitelist; многострочные значения `•`/`1.` клеить к текущему полю; пропуски → `null`) → собрать `text` из всех полей кейса → взять `topic`/`pillar` → `CaseChunk[]` → `writeChunkTree("case", …)` + `writeReport`. Ссылаться на `lib/clean`, `lib/fs`, `lib/types`, `case/config`.
4. **`case/validate.ts`.** Критерии V1–V10 (см. ниже) + структура (уникальность `id`, счётчик = 68). Ссылаться на `lib/clean` (`RESIDUAL_ESCAPE`), `lib/types`. Типы (`Violation`, `Criterion`) — в файле типов.
5. **`case/load.ts`.** Флоу: `readChunkTree<CaseChunk>("case")` → dry-run по умолчанию; `--apply` → `withRetry(() => prisma.chunk.upsert(...))` с case-полями (без `canPublish`). Ссылаться на `shared/lib/net/with-retry`, `db/prisma`, `lib/fs`.
6. **Диспетчеры.** В `chunk.ts` добавить ветку `case`; в `load.ts` — `case: () => import("./case/load")`. Гейт `validate-chunks.ts` сделать параметризованным по типу (или отдельный `case`-гейт).
7. **Комментарии.** Только на неочевидных местах: два формата карточек, многострочные значения, пропущенные поля. Не в каждом углу.

## Валидации (`case/validate.ts`)

- V1 остаточное экранирование markdown — error
- V2 HTML/Markdown-теги — error
- V3 двойные пробелы — warn
- V4 пробелы в конце строки — warn
- V5 пустой `text` — error
- V6 `pillar ∈ {PROOF, METHOD, TRUST, HUMAN}` или null — error
- V7 символ замены U+FFFD — error
- V8 доля кириллицы < 50% — warn
- V9 пустой `sourcePath` — error
- V10 `sourceUrl` (если есть) валидный URL или null — error
- Структура: уникальность `id`; счётчик = 68.

## Load: отличие от fact

- Общее: `withRetry`, dry-run/`--apply`, `readChunkTree`, `prisma.chunk.upsert`.
- Отличие в upsert-данных: `{ type:"case", text, topic, pillar, sourcePath }` — **без `canPublish`**; `fearClosed`, `cooldownUntil`, `embedding` при создании `null`; `depletion = 1.0`.

## Тесты (минимальные, в конце)

- Смоук: `chunk case` → 68 JSON в `data/chunks/case`; `validate-chunks case` → 0 errors.
- Юнит: парс 1 кейса из `CASE.md` даёт непустой `text` и заполненный `pillar`.
- Load dry-run: печатает план, ничего не пишет.

## Ограничения

- `fearClosed` и `embedding` — `null` (позже).
- У 0003/0027/0046 проставлен `pillar: PROOF`.
- Векторы — отдельная итерация.