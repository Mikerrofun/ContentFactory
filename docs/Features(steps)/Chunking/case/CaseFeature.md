---

**Дата:** 26.11.2026
**Теги:** #features #chunking #rag

---

## 1. Зачем

Исходник `docs/Facts:Case:Best/CASE.md` — 68 историй учеников `CASE_0001…CASE_0069` (без `0067`) в сыром markdown с экранированием (`\~`, `1\.`, `---`). Нарезать в RAG-чанки нельзя: в шапке 5 инструкц. H2 (не кейсы), у карточек два «подводных камня» — многострочные значения (буллеты `•` / нумерация `1.`) и пропущенные поля/заголовки. Нужен детерминированный пайплайн по тому же паттерну, что и `fact`: очистка → нарезка → JSON → валидация → загрузка, изолированно от других типов.

## 2. Где/что уже было

- Общий слой `lib/` (`clean/`, `fs/`, `types.ts`) и `src/shared/lib/net/with-retry.ts` — переиспользованы как есть.
- Эталон per-type реализации — `fact/` (`chunk.ts` + `load.ts` + `validate.ts`).
- Схема `prisma/schema.prisma`: модель `Chunk` с `type`, `text`, `topic`, `pillar`, `sourcePath`, `fearClosed`, `depletion`, `cooldownUntil`.

Задача — не писать новую инфраструктуру, а добавить ещё один изолированный тип `case` по образцу `fact`.

## 3. Реализация

### Типы — `lib/types.ts`

Добавлен `CaseChunk` (типизация живёт в файле типов, не в логике):

```ts
export interface CaseChunk {
  id: string;            // CASE_0001… из заголовка
  type: "case";
  text: string;          // весь кейс (START+GOAL+ACTIONS+RESULT+INSIGHT+STEP), очищенный — он же в вектор
  topic: string | null;  // ниша/предмет
  pillar: string | null; // PROOF/METHOD/TRUST/HUMAN (у всех 68 — PROOF)
  sourcePath: string;    // путь к CASE.md
  fearClosed: string[] | null; // null сейчас, заполнит LLM по fear_markers позже
  depletion: number;     // 1.0 при создании → снижается по мере использования
  cooldownUntil: string | null; // ставится при использовании
  embedding: null;       // вектор — отдельная итерация
  addedAt: string;       // ISO
}
```

`ChunkRunResult` сделан generic (`ChunkRunResult<T = FactChunk>`), чтобы не плодить типы под каждый чанкер.

Отличия от `fact`-чанка: **нет `canPublish`**; у `case` есть `topic/pillar/depletion/cooldownUntil/fearClosed/embedding`. Убраны `hero` (есть в тексте) и `sourceUrl` (хватает `sourcePath`).

### Конфиг — `case/config.ts` (FSD)

Пути/константы не хардкодятся в логике:

```ts
export const CASE_PATH = "docs/Facts:Case:Best/CASE.md";
export const SOURCE_CASE = "docs/Facts:Case:Best/CASE.md";
export const EXPECTED_CASE_COUNT = 68;
export const CASE_FIELDS = [...] as const;   // whitelist полей-маркеров
export const TEXT_ORDER: CaseField[] = [...]; // порядок склейки 6 секций в text
export const PILLAR_VALUES = ["PROOF","METHOD","TRUST","HUMAN"] as const;
```

### Чанкер — `case/chunk.ts`

```ts
export function parseCases(raw: string): RawCard[]
export function runCaseChunker(): { chunks: CaseChunk[]; report: Report }
```

Флоу: `readFileSync(CASE_PATH)` → `clean()` → парс карточек → `CaseChunk[]` → `writeChunkTree("case", …)` + `writeReport`.

Правила парсинга (из `case.md`):
1. Пропустить всё до первого `^## CASE_` (шапка с инструкциями — не кейсы).
2. Новая карточка — строка `^## CASE_`; `id` = `CASE_####` из заголовка.
3. Маркер поля — `^([A-Za-zА-Яа-яЁё ()0-9_-]+):\s?(.*)$` **при whitelist** (`CASE_FIELDS`). Только известное имя открывает поле.
4. Продолжение — строка без маркера известного поля (в т.ч. `• …`, `1. …`, пустые) → клеится к текущему полю.
5. Пустое значение → `null`/`[]`.
6. `text` собирается `buildText()` из 6 секций `TEXT_ORDER` (START+GOAL+ACTIONS+RESULT+KEY INSIGHT+REPEATABLE STEP).

**Подводный камень (реальные данные):** у 4 карточек (`0005/0018/0027/0046`) в источнике **отсутствует заголовок `START (контекст):`** — её буллеты идут сразу после `pillar: PROOF`. Чтобы `pillar` не «съедал» чужой текст, однозначные поля (`source_type/source_link/date/topic/pillar`) объявлены `SINGLE_LINE` — к ним continuation-строки не клеятся (берётся только значение на строке-маркере). Контент-секции остаются многострочными.

### Валидация — `case/validate.ts` (только для case)

```ts
export function validateChunk(chunk: CaseChunk): Violation[]
export function validateSet(chunks: CaseChunk[], expected?): Violation[]
export function summarize(violations): { errors; warnings }
// типы (Severity, Violation, Criterion) — здесь же.
```

Критерии (независимая детекция, `severity: error | warn`):

| ID | Проверяет | sev |
|---|---|---|
| V1 | остаточное экранирование markdown (`RESIDUAL_ESCAPE`) | error |
| V2 | HTML/Markdown-теги | error |
| V3 | двойные пробелы | warn |
| V4 | пробелы в конце строки | warn |
| V5 | пустой `text` | error |
| V6 | `pillar ∈ {PROOF,METHOD,TRUST,HUMAN}` или null | error |
| V7 | символ замены U+FFFD | error |
| V8 | доля кириллицы < 50% | warn |
| V9 | пустой `sourcePath` | error |

Структурные проверки: уникальность `id`, счётчик = `EXPECTED_CASE_COUNT` (68).
V10 (`sourceUrl` URL) **не реализован** — поля `sourceUrl` в `CaseChunk` нет (убрано по плану).

### Загрузчик — `case/load.ts`

dry-run по умолчанию; `--apply` → `upsert` в `Chunk` через `withRetry(3)`. Требует `DATABASE_URL`.

Отличие upsert-данных от `fact`: `{ type:"case", text, topic, pillar, sourcePath }` — **без `canPublish`**; `depletion = 1.0` задаётся только при `create` (в `update` не трогаем, чтобы не сбрасывать износ при перезаливке); `fearClosed/cooldownUntil/embedding` при создании `null`.

### Диспетчеры и гейт

```ts
// chunk.ts           → case "case" (ветка + runCaseChunker)
// load.ts            → case: () => import("./case/load")  (dynamic import по типу)
// validate-chunks.ts → RUNNERS: { fact, case } (параметризован по типу, exit 1 при errors)
```

## 4. UI

Не применимо — это пайплайн обработки данных.

## 5. Поток данных

```
docs/Facts:Case:Best/CASE.md
↓
runCaseChunker() → parseCases() → clean() → CaseChunk[]
↓
writeChunkTree("case") → data/chunks/case/<CASE_####>.json + _report.md
↓
validate-chunks.ts case → validateSet() → exit 0 = можно грузить
↓
load.ts case --apply → withRetry(prisma.chunk.upsert) → Postgres Chunk
```

Основные функции:
- `parseCases(raw)` — сырой текст → `RawCard[]` (поля карточек, `id` из заголовка).
- `buildText(fields)` — склеивает 6 секций в `text` (он же в вектор).
- `toChunk(card, addedAt)` — `RawCard` → `CaseChunk` (topic/pillar → `null` при пустом; `depletion 1.0`; остальное `null`).
- `runCaseChunker()` — собирает чанки, пишет дерево и отчёт.

## 6. Почему так, а не иначе

1. **Тот же per-type паттерн, что `fact`** (свой `chunk/load/validate` + строка в диспетчере): добавить новый тип = новый каталог, без правки существующих.
2. **Весь кейс в `text`** (не дробим на `steps/result/heroBio`): как у `fact`, в вектор идёт цельный кейс; отдельными полями — только нужное для фильтрации/поведения (`topic/pillar`).
3. **Валидация отдельным гейтом** (`validate-chunks.ts`), а не внутри чанкера: проверяется результат, а не сам себя.
4. **SINGLE_LINE-поля** — защита от реального дефекта источника (пропущенный заголовок `START`), чтобы `pillar` не впитывал чужие буллеты.
5. **`depletion` в `create`, не в `update`** — перезаливка не сбрасывает накопленный износ.

## 7. Ограничения

- `fearClosed` и `embedding` — `null` (LLM/векторы — позже).
- `cooldownUntil` ставится при использовании, не при индексации.
- У всех 68 `pillar: PROOF`.
- Векторы — отдельная итерация.

## 8. Проверка (смоук)

- `npx tsx src/scripts/chunking/chunk.ts case` → 68 JSON в `data/chunks/case` + `_report.md`.
- `npx tsx src/scripts/chunking/validate-chunks.ts case` → 0 errors, 0 warnings.
- `npx tsx src/scripts/chunking/load.ts case` → dry-run (печатает план, не пишет).
- `fact` не затронут (98 чанков, OK); `typecheck` + `eslint` чисто.