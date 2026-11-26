# Паттерн нарезки `best` (переименование voice → best)

## Context

Нужно добавить новый тип чанка `best` по образцу `fact`/`case` (per-type паттерн: `chunk.ts` + `load.ts` + `validate.ts` + `config.ts`, общий слой `lib/`). Источник — `docs/Facts:Case:Best/BEST.md` (65 постов-эталонов). Параллельно переименовать тип чанка `voice` → `best` в коде и БД (концепт «голос автора» в `VOICE.md`/`VOICE_FINGERPRINT.md` НЕ трогаем).

Решения (подтверждены):
- Переименование только типа чанка + код + БД; концептуальные доки не трогаем.
- `text` = весь блок поста целиком (метаданные + тело), очищенный; `pillar`/`format` — отдельные поля (плейсхолдеры → `null`).

### Что показал анализ источника (отличия от bestPlan.md)
- 65 постов, id `VK-P-0001…0067` без `0016` и `0029`. Заголовки уже одного вида `## **POST VK-P-#### …**`.
- Метаданные **гетерогенны, 4 схемы**: `Платформа/Дата/Цель/Контекст/Метрика`; `Источник/URL/Дата/Тематика/Пиллар/Формат/Триггеры/Хуки/Заметки`; англ. `SOURCE:/TAGS:/PILLAR / INTENT:/RAW TEXT:`; `Дата/Ссылка/Пиллар/Формат/Триггеры/Ключевая идея/CTA/Тэги`.
- `Пиллар`/`Pillar`/`PILLAR` ~15 строк, `Формат` 11; часть — плейсхолдеры. Счётчики bestPlan (4/11) ненадёжны → pillar/формат извлекаем динамически, без форса количества; валидируем enum-or-null.
- Многострочные значения и markdown hard-break `\` в конце строк метаданных.

## Переименование voice → best

1. `prisma/schema.prisma`: enum `ChunkType` — `voice` → `best`.
2. Новая миграция `prisma/migrations/<ts>_rename_voice_to_best/migration.sql`:
   `ALTER TYPE "ChunkType" RENAME VALUE 'voice' TO 'best';` (БД пуста по voice — безопасно).
3. `src/scripts/chunking/lib/types.ts`: union `ChunkType` `voice`→`best`; добавить `BestChunk`.
4. Диспетчеры используют `best`. `fact`/`case` не трогаем.

## Новые файлы (по образцу `case/`)

### `src/scripts/chunking/best/config.ts`
- `BEST_PATH`, `SOURCE_BEST` = `docs/Facts:Case:Best/BEST.md`; `EXPECTED_BEST_COUNT = 65`.
- `PILLAR_VALUES = ["PROOF","METHOD","TRUST","HUMAN"] as const`.
- `HEADER_RE = /^##\s+\*\*POST\s+(VK-P-\d+)\b/`; `PLACEHOLDER_RE` (заполнить/не удалось/не извлеч/---/пусто).

### `src/scripts/chunking/best/chunk.ts`
`readFileSync(BEST_PATH)` → `clean()` → сплит по `HEADER_RE` → на блок:
- `id` = `BEST-0001…` по порядку; `text` = весь очищенный блок (hard-break `\`→перенос);
- `pillar` = первое enum-слово из `^(Пиллар|Pillar|PILLAR)\s*[:/]`; плейсхолдер/пусто → `null`;
- `format` = значение `^Формат:`; плейсхолдер/пусто → `null`;
- `sourcePath=SOURCE_BEST`; `sScheme/closingType/markers/embedding=null`; `addedAt` ISO.
→ `writeChunkTree("best", …)` + `writeReport`. Ссылки: `lib/clean`, `lib/fs`, `lib/types`, `best/config`.

### `src/scripts/chunking/best/validate.ts`
V1–V9 (как `case/validate.ts`): V1 остаточное экранирование, V2 HTML-теги, V3 двойные пробелы (warn), V4 trailing (warn), V5 пустой text, V6 `pillar ∈ PILLAR_VALUES|null`, V7 U+FFFD, V8 кириллица<50% (warn), V9 пустой sourcePath. Структура: уникальность `id`, счётчик=65.

### `src/scripts/chunking/best/load.ts`
По образцу `case/load.ts`: `readChunkTree<BestChunk>("best")` → dry-run/`--apply` → `withRetry(prisma.chunk.upsert)`. Upsert: `{ type:"best", text, pillar, format, sourcePath }` (без `canPublish`, без `depletion` в update; остальное при create `null`).

## Диспетчеры/гейт
- `chunk.ts`: ветка `best` → `runBestChunker()`; обновить список в ошибке.
- `load.ts`: `best: () => import("./best/load")`.
- `validate-chunks.ts`: `RUNNERS.best = (c) => validateBest(c as BestChunk[], 65)`.

## Verification
1. `npm run db:migrate` — миграция rename voice→best применяется.
2. `npx tsx src/scripts/chunking/chunk.ts best` → 65 JSON + `_report.md`.
3. `npx tsx src/scripts/chunking/validate-chunks.ts best` → `errors=0`.
4. `npx tsx src/scripts/chunking/load.ts best` → dry-run.
5. Регресс: `fact`/`case` чанк+валидация без изменений.
6. `npm run typecheck` + `npm run lint` — чисто.

## Ограничения
- `sScheme/closingType/markers/embedding` = `null` (LLM/векторы позже).
- `pillar`/`format` — best-effort; плейсхолдеры → `null`.
- Векторы — отдельная итерация.