---

**Дата:** 26.11.2026
**Теги:** #features #chunking #rag

---

## 1. Зачем

Исходник `docs/Facts:Case:Best/SWIPES.md` — 56 карточек-морф-шаблонов постов (5 секций: META, КЛАССИФИКАЦИЯ, ТЕГИ, TEXT-оригинал, РАЗБОР МЕХАНИКИ) в сыром markdown с экранированием (`\~`, `\[`, `\]`, `\#`). Нарезать в RAG-чанки нельзя: нет единого формата, разбор механики лежит в буллетах `●`, запись в БД должна быть воспроизводимой и безопасной. Нужен детерминированный пайплайн по тому же per-type паттерну, что и `fact`/`case`/`best`/`audience`: очистка → нарезка → JSON → валидация → загрузка, изолированно от других типов.

## 2. Где/что уже было

- Общий слой `lib/` (`clean/`, `fs/`, `types.ts`) и `src/shared/lib/net/with-retry.ts` — переиспользованы как есть.
- Эталон per-type реализации — `case/`, `best/` (`chunk.ts` + `load.ts` + `validate.ts` + `config.ts`); `best` ближе всего (цельный блок в `text` + метаданные полями).
- Схема `prisma/schema.prisma`: модель `Chunk` с `type`, `text`, `pillar`, `format`, `whyItWorks`, `structure`, `patternsToBorrow`, `doNotCopy`, `sourcePath`, `embedding`; `ChunkType` уже содержит `swipe`. Миграция не нужна.

Задача — не писать новую инфраструктуру, а добавить ещё один изолированный тип `swipe` по образцу `best`.

## 3. Реализация

### Типы — `lib/types.ts`

Добавлен `SwipeChunk` (типизация живёт в файле типов, не в логике):

```ts
export interface SwipeChunk {
  id: string;            // SW-0001… по порядку
  type: "swipe";
  text: string;          // вся карточка (META+класс+теги+оригинал+разбор), очищенная — он же в вектор
  pillar: string | null; // PILLAR (HUMAN/METHOD/PROOF/TRUST)
  format: string | null; // FORMAT
  sourcePath: string;    // путь к SWIPES.md
  whyItWorks: string[] | null;        // WHY_IT_WORKS (bullets ●)
  structure: string[] | null;         // STRUCTURE (скелет, построчно)
  patternsToBorrow: string[] | null;  // PATTERNS_TO_BORROW (bullets ●)
  doNotCopy: string[] | null;         // DO_NOT_COPY (bullets ●)
  embedding: null;       // вектор — отдельная итерация
  addedAt: string;       // ISO
}
```

Отличия от `fact`/`case`/`best`: **нет `canPublish`/`depletion`/`cooldownUntil`/`topic`**; есть 4 массива разбора (`whyItWorks/structure/patternsToBorrow/doNotCopy`). Единица — **1 карточка = 1 чанк** (текст+разбор вместе), а не фраза/пост-без-разбора.

### Конфиг — `swipe/config.ts` (FSD)

Пути/константы не хардкодятся в логике:

```ts
export const SWIPES_PATH = "docs/Facts:Case:Best/SWIPES.md";
export const SOURCE_SWIPE = "docs/Facts:Case:Best/SWIPES.md";
export const EXPECTED_SWIPE_COUNT = 56;
export const CARD_BOUNDARY = "**ЕДИНАЯ КАРТОЧКА ПОСТА**";
export const SECTION_HEADER_RE = /^\*\*\d\)/;        // `**1) META**` … `**5) …**`
export const COLON_MARKER_RE = /^•\s+(.+?):\s?(.*)$/; // `• KEY: value`
export const PAREN_MARKER_RE = /^•\s+([A-Za-zА-Яа-яЁё_]+)\s*\(/; // `• KEY (описание)`
export const SWIPE_FIELDS = [...] as const;          // whitelist канонических имён
export const SINGLE_LINE_FIELDS = ["REF_ID","ORIG_REF_ID","SOURCE","PLATFORM","DATE","PILLAR","FORMAT"];
export const BULLET_FIELDS = ["WHY_IT_WORKS","PATTERNS_TO_BORROW","DO_NOT_COPY","ROMAN_ADAPTATION_NOTE"];
export const LINE_FIELD = "STRUCTURE";
export const PILLAR_VALUES = ["PROOF","METHOD","TRUST","HUMAN"] as const;
```

`SWIPE_FIELDS` — whitelist: только известное имя открывает поле, строки с `•` вне списка — продолжение. `canonicalName` снимает скобочный хвост (`ТЕМА/НИША (1 строка)` → `ТЕМА/НИША`, `ЦА (если понятно)` → `ЦА`).

### Чанкер — `swipe/chunk.ts`

```ts
export function parseCards(raw: string): RawCard[]
export function runSwipeChunker(): { chunks: SwipeChunk[]; report: Report }
```

Флоу: `readFileSync(SWIPES_PATH)` → `clean()` → парс карточек → `SwipeChunk[]` → `writeChunkTree("swipe", …)` + `writeReport`.

Правила парсинга:
1. Граница карточки — строка `**ЕДИНАЯ КАРТОЧКА ПОСТА**`: закрывает текущую и открывает новую.
2. Заголовок секции `^**N)` — закрывает текущее поле, но **не** меняет карточку (в `text` остаётся).
3. Маркер поля с двоеточием `• KEY: value` — значение на строке-маркере; имя нормализуется и сверяется с whitelist.
4. Маркер-блок `• KEY (описание)` без двоеточия (TEXT + секция 5) — значение идёт следующими строками.
5. Продолжение — непустая строка без маркера → клеится к текущему полю (кроме `SINGLE_LINE`).
6. `text` = **вся карточка** (все строки между границами, очищенные), он же в вектор.
7. Секция 5 → массивы: `●`-поля (`WHY_IT_WORKS/PATTERNS_TO_BORROW/DO_NOT_COPY/ROMAN_ADAPTATION_NOTE`) бьются по маркеру `●` (продолжения склеиваются пробелом); `STRUCTURE` — построчно.

**Подводный камень (реальные данные):** в карточке 6 маркеров-блоков без двоеточия (`TEXT`, `WHY_IT_WORKS`, `STRUCTURE`, `PATTERNS_TO_BORROW`, `DO_NOT_COPY`, `ROMAN_ADAPTATION_NOTE`) и 13 colon-полей; у части полей скобочные хвосты (`(1 строка)`, `(если понятно)`). Парсер различает их двумя регэкспами и нормализует имя, иначе `ТЕМА/НИША` не попала бы в whitelist и её многострочное значение «съело» бы `PILLAR`. `ROMAN_ADAPTATION_NOTE` парсится как отдельное поле, чтобы его буллеты не перетекали в `DO_NOT_COPY` (в схеме отдельной колонки нет — живёт в `text`).

### Валидация — `swipe/validate.ts` (только для swipe)

```ts
export function validateChunk(chunk: SwipeChunk): Violation[]
export function validateSet(chunks: SwipeChunk[], expected?): Violation[]
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

Структурные проверки: уникальность `id`, счётчик = `EXPECTED_SWIPE_COUNT` (56).

### Загрузчик — `swipe/load.ts`

dry-run по умолчанию; `--apply` → `upsert` в `Chunk` через `withRetry(3)`. Требует `DATABASE_URL`.

Отличие upsert-данных: `{ type:"swipe", text, pillar, format, sourcePath, whyItWorks, structure, patternsToBorrow, doNotCopy }` — **без `canPublish`/`depletion`**; `embedding` при создании `null` (дефолт схемы). Json-колонки (`whyItWorks/structure/patternsToBorrow/doNotCopy`) пишутся через `jsonOrNull()` → `Prisma.JsonNull` (Prisma не принимает `null` в Json-поле).

### Диспетчеры и гейт

```ts
// chunk.ts           → swipe "swipe" (ветка + runSwipeChunker)
// load.ts            → swipe: () => import("./swipe/load")  (dynamic import по типу)
// validate-chunks.ts → RUNNERS.swipe = (c) => validateSwipe(c as SwipeChunk[], 56)  (exit 1 при errors)
```

## 4. UI

Не применимо — это пайплайн обработки данных.

## 5. Поток данных

```
docs/Facts:Case:Best/SWIPES.md
↓
runSwipeChunker() → parseCards() → clean() → SwipeChunk[]
↓
writeChunkTree("swipe") → data/chunks/swipe/<SW-####>.json + _report.md
↓
validate-chunks.ts swipe → validateSet() → exit 0 = можно грузить
↓
load.ts swipe --apply → withRetry(prisma.chunk.upsert) → Postgres Chunk
```

Основные функции:
- `parseCards(raw)` — сырой текст → `[{ block, fields }]` (карточки + поля, `block` = весь текст карточки).
- `matchField(line)` — нормализует имя и открывает поле только из whitelist (colon/paren).
- `canonicalName(raw)` — снимает скобочный хвост имени поля.
- `toArray(value, mode)` — поле-блок → `string[]` (`bullet` по `●` / `line` построчно).
- `toChunk(card, id, addedAt)` — карточка → `SwipeChunk` (`pillar/format` → `null` при пустом; массивы → `null` при пустом).
- `runSwipeChunker()` — собирает чанки, пишет дерево и отчёт.

## 6. Почему так, а не иначе

1. **Тот же per-type паттерн, что `case`/`best`** (свой `chunk/load/validate/config` + строка в диспетчере): добавить новый тип = новый каталог, без правки существующих.
2. **Вся карточка в `text`** (не дробим на META/текст/разбор): как у `best`, в вектор идёт цельная карточка; отдельными полями — только нужное для фильтрации/поведения (`pillar/format`) и 4 массива разбора.
3. **Два регэкспа маркеров + whitelist + `canonicalName`** — защита от реального дефекта источника (скобочные хвосты в именах полей), чтобы `PILLAR`/`FORMAT` не впитывали чужие многострочные значения.
4. **`ROMAN_ADAPTATION_NOTE` — отдельное поле** (не в `DO_NOT_COPY`): его буллеты не должны попадать в «что нельзя переносить»; в схеме колонки нет — живёт в `text`.
5. **Json через `Prisma.JsonNull`**, а не `null`: Prisma 7 не принимает `null` в Json-поле (тип-безопасность).
6. **Валидация отдельным гейтом** (`validate-chunks.ts`), а не внутри чанкера: проверяется результат, а не сам себя.

## 7. Ограничения

- `embedding` — `null` (векторы — позже).
- 1 карточка = 1 чанк (текст+разбор вместе).
- `pillar` — best-effort из `PILLAR`; `format` — из `FORMAT`.
- Векторы — отдельная итерация.

## 8. Проверка (смоук)

- `npx tsx src/scripts/chunking/chunk.ts swipe` → 56 JSON в `data/chunks/swipe` + `_report.md`.
- `npx tsx src/scripts/chunking/validate-chunks.ts swipe` → 0 errors, 0 warnings.
- `npx tsx src/scripts/chunking/load.ts swipe` → dry-run (печатает план, не пишет).
- `fact`/`case`/`best`/`audience` не затронуты (валидация OK); `typecheck` + `eslint` чисто.
- Распределение `pillar`: HUMAN 42, METHOD 13, PROOF 1 (все 56 непустые, `structure`/`whyItWorks`/`doNotCopy` заполнены).