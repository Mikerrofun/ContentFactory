---

**Дата:** 26.11.2026
**Теги:** #features #chunking #rag

---

## 1. Зачем

Исходники лежат в `docs/Facts:Case:Best` и `docs/Info_ForGeneration` в сыром markdown с экранированием (`\##`, `\-`, `\~`). Нарезать их в RAG-чанки нельзя: нет единого формата карточек, мусор в тексте, а запись в БД должна быть воспроизводимой и безопасной. Нужен детерминированный пайплайн: очистка → нарезка → JSON → валидация → загрузка. Плюс чанкеры разных типов не должны мешать друг другу.

## 2. Где/что уже было

- Prisma-клиент `src/db/prisma.ts` (driver adapter, `DATABASE_URL`) — переиспользован как есть.
- Схема `prisma/schema.prisma`: модель `Chunk` с `type`, `text`, `sourcePath`.
- `tsx` для запуска скриптов, `package.json` scripts.

Задача была не писать новую инфраструктуру, а добавить общий слой (`lib/`) и по одному чанкеру/загрузчику на тип.

## 3. Реализация

### Общий слой `src/scripts/chunking/lib/`

Подпапка на каждый файл: `clean/`, `fs/` (+ общий `types.ts`). Внутри подпапки — реализация + `types.ts` с типами + `index.ts` баррель (импорты снаружи не меняются). `validate` — не общий, лежит в `fact/validate.ts` (критерии зависят от типа).

#### Очистка — `lib/clean/`

```ts
// src/scripts/chunking/lib/clean/clean.ts
export function clean(raw: string): { text: string; stats: CleanStats }
export function subAll(text, pattern, replacement): RuleResult    // все вхождения + счётчик
export function subOnce(text, pattern, replacement, label): RuleResult // ровно 1 вхождение, иначе throw
export const RESIDUAL_ESCAPE: RegExp                             // остаточное экранирование (для валидатора)
```

- Порядок: де-экранирование markdown (`\-`→`-`, `\#`→`#`, `\~`, `\[`, `\]`, `\_`, `\\`) → нормализация (BOM, CRLF→LF, пробелы в конце строк, 3+ пустых строк → 2, двойные пробелы, финальный `trim`).
- `subOnce` бросает, если вхождение не ровно одно — защита от молчаливой порчи (паттерн из cleanup-заметки: правка проверяется в момент, а не через 300 строк).
- `stats` считает срабатывания по каждому правилу → идёт в отчёт.
- Детерминированно: `clean(clean(x)) === clean(x)`.
- Типы (`RuleResult`, `CleanStats`) — в `clean/types.ts`.

#### Валидация — `fact/validate.ts` (только для fact)

```ts
// src/scripts/chunking/fact/validate.ts
export function validateChunk(chunk: FactChunk): Violation[]
export function validateSet(chunks: FactChunk[], expected?): Violation[]
export function summarize(violations): { errors; warnings }
// типы (Severity, Violation, Criterion) — здесь же.
```

Критерии (независимая детекция, `severity: error | warn`):

| ID | Проверяет | sev |
|---|---|---|
| V1 | остаточное экранирование markdown | error |
| V2 | HTML/Markdown-теги | error |
| V3 | двойные пробелы | warn |
| V4 | пробелы в конце строки | warn |
| V5 | пустой `text` | error |
| V6 | `canPublish ∈ {yes,partial,no}` | error |
| V7 | символ замены U+FFFD | error |
| V8 | доля кириллицы < 50% | warn |
| V9 | пустой `sourcePath` | error |

Структурные проверки: уникальность `id`, счётчики (`fact=71`, `PF=27`).
Гейт `validate-chunks.ts` **отдельно** от чанкера: `exit 1` при errors → в БД не грузим. Проверяется результат, а не сам чанкер.

#### Файловая система — `lib/fs/` (универсальная, generic)

```ts
// src/scripts/chunking/lib/fs/fs.ts
export function writeChunkTree<T>(type, chunks: T[]): void   // rmSync + запись data/chunks/<type>/*.json
export function readChunkTree<T>(type): T[]                   // чтение дерева (generic, без привязки к типу)
export function writeReport(type, report): void               // _report.md
```

### Общий системный слой `src/shared/lib/net/`

```ts
// src/shared/lib/net/with-retry.ts
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, options?: WithRetryOptions): Promise<T>
// attempts=3, backoffMs=400, signal, shouldRetry. RetryableError/isRetryableStatus/isRetryableError.
// Общий для всей системы (не только чанкинга): один withRetry, одна политика ретрая.
```

### Чанкер типа `fact`

```ts
// src/scripts/chunking/fact/chunk.ts
export function parseFacts(raw: string): RawCard[]
// clean → два формата карточек: «## Карточка»/«- » и «Карточка:»/«• »; мультистрочные значения и пустые поля.
export function parseProductFacts(raw, addedAt): FactChunk[]  // строки «- Факт: …» → PF-0001…
export function runFactChunker(): { chunks; report }          // 71 FACTS + 27 PRODUCT_FACTS → JSON + отчёт
```

### Загрузчик типа `fact`

```ts
// src/scripts/chunking/fact/load.ts
// dry-run по умолчанию; --apply → upsert в Chunk через withRetry(3). Требует DATABASE_URL.
```

### Диспетчеры и гейт

```ts
// src/scripts/chunking/chunk.ts        // npx tsx …/chunk.ts fact
// src/scripts/chunking/load.ts         // npx tsx …/load.ts fact --apply (dynamic import по типу)
// src/scripts/chunking/validate-chunks.ts  // отдельный гейт, exit 1 при errors
```

### Схема

```prisma
// prisma/schema.prisma
enum CanPublish { yes partial no }
model Chunk { … canPublish CanPublish? … }
```

Миграция `20261126195456_add_canpublish` создана и применена.

## 4. UI

Не применимо — это пайплайн обработки данных.

## 5. Поток данных

```
ФАЙЛЫ docs/Facts:Case:Best/FACTS.md + docs/Info_ForGeneration/PRODUCT_FACTS.md
↓
runFactChunker() → parseFacts()/parseProductFacts() → clean() → FactChunk[]
↓
writeChunkTree("fact") → data/chunks/fact/<id>.json + _report.md
↓
validate-chunks.ts → validateSet() → exit 0 = можно грузить
↓
load.ts fact --apply → withRetry(prisma.chunk.upsert) → Postgres Chunk
```

Основные функции:
- `parseFacts(raw)` — принимает сырой текст, отдаёт `RawCard[]` (поля карточек).
- `buildText(fields)` — склеивает все поля в `text` (он же в вектор).
- `mapCanPublish(v)` — «да»→yes, «с оговорками»→partial, иначе no.
- `runFactChunker()` — собирает чанки, пишет дерево и отчёт.
- `withRetry(fn)` — 3 попытки, backoff 400 мс, ретрай только ретраебельных ошибок.

## 6. Почему так, а не иначе

1. **Общий `withRetry` в `src/shared/lib/net/`** (не только чанкинг), а не в каждом load: одна политика ретрая на всю систему.
2. **Чанкер и load — на каждый тип свои** (`fact/chunk.ts`, `fact/load.ts`): добавить новый тип = новый каталог + строка в диспетчере, без правки существующих.
3. **Валидация отдельным гейтом** (`validate-chunks.ts`), а не внутри чанкера: проверяется результат, а не сам себя.
4. **Миграция и load через прямой хост Neon** (без `-pooler`): pooler + adapter даёт P1003, прямой эндпоинт работает.

## Преимущества

- ✅ Детерминированная нарезка: одинаковый вход → одинаковые JSON.
- ✅ Один `withRetry` на весь пайплайн, ретрай только ретраебельного.
- ✅ Каждый тип чанка изолирован: свой chunk + свой load.
- ✅ Валидатор ловит регрессии до записи в БД (exit 1).
- ✅ Загрузка идемпотентна (upsert) и переживает сбои (retry 3×).
- ✅ 98 чанков fact записаны в БД (81 yes + 17 partial).