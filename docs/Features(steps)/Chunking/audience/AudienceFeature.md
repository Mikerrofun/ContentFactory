---

**Дата:** 26.11.2026
**Теги:** #features #chunking #rag

---

## 1. Зачем

Исходник `docs/Facts:Case:Best/AUDIENCE.md` — банк живого языка аудитории (страхи/возражения/желания/триггеры/ограничения + лексика, CTA, скрытые страхи, «красные слова», дополнения из комментариев) в сыром markdown с экранированием (`\##`, `\-`, `\*`, `\>`, `` \` ``). Нарезать в RAG-чанки нельзя: нет единого формата, мусор в тексте, запись в БД должна быть воспроизводимой и безопасной. Нужен детерминированный пайплайн по тому же per-type паттерну, что и `fact`/`case`/`best`: очистка → нарезка → JSON → валидация → загрузка, изолированно от других типов.

## 2. Где/что уже было

- Общий слой `lib/` (`clean/`, `fs/`, `types.ts`) и `src/shared/lib/net/with-retry.ts` — переиспользованы как есть.
- Эталон per-type реализации — `fact/`, `case/`, `best/` (`chunk.ts` + `load.ts` + `validate.ts` + `config.ts`).
- Схема `prisma/schema.prisma`: модель `Chunk` с `type`, `text`, `emotion`, `fearType`, `sourcePath`; `ChunkType` уже содержит `audience`. Миграция не нужна.

Задача — не писать новую инфраструктуру, а добавить ещё один изолированный тип `audience` по образцу `best`.

## 3. Реализация

### Типы — `lib/types.ts`

Добавлены `AudienceEmotion` (union 12 категорий) и `AudienceChunk` (типизация живёт в файле типов, не в логике):

```ts
export type AudienceEmotion =
  | "страх" | "возражение" | "желание" | "триггер" | "ограничение"
  | "инструкция" | "лексика" | "скрытый страх" | "успокоитель"
  | "красное слово" | "CTA" | "прочее";

export interface AudienceChunk {
  id: string;            // AUD-0001… по порядку
  type: "audience";
  text: string;          // одна фраза (дословно), очищенная — он же в вектор
  emotion: AudienceEmotion | null; // категория из секции (детерминированно)
  fearType: number | null;         // 1–7 для страхов, заполнит LLM позже; сейчас null
  sourcePath: string;    // путь к AUDIENCE.md
  embedding: null;       // вектор — отдельная итерация
  addedAt: string;       // ISO
}
```

Отличия от `fact`/`case`/`best`: **нет `canPublish`/`depletion`/`cooldownUntil`**; есть `emotion` (детерминированный из секции) и `fearType` (пока `null`). Единица — **1 фраза = 1 чанк** (атомарность для RAG), а не карточка/пост.

### Конфиг — `audience/config.ts` (FSD)

Пути/константы не хардкодятся в логике:

```ts
export const AUDIENCE_PATH = "docs/Facts:Case:Best/AUDIENCE.md";
export const SOURCE_AUDIENCE = "docs/Facts:Case:Best/AUDIENCE.md";
export const SECTION_EMOTION: ReadonlyArray<readonly [RegExp, AudienceEmotion]> = [...];
export const FEAR_EMOTIONS: readonly AudienceEmotion[] = ["страх", "скрытый страх"];
export const EMOTION_VALUES: readonly AudienceEmotion[] = [...];
export function emotionForSection(title: string): AudienceEmotion;
```

`SECTION_EMOTION` — маппинг секции (H2, текст после `## `) → emotion по ведущему номеру/ключу, первое совпадение выигрывает:

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

`10)` не матчит `/^1\)/` (после `1` идёт `0`, а не `)`). `FEAR_EMOTIONS` — страхи/скрытые страхи (для будущего `fearType`).

### Чанкер — `audience/chunk.ts`

```ts
export function parsePhrases(raw: string): Array<{ text: string; emotion: AudienceEmotion }>
export function runAudienceChunker(): { chunks: AudienceChunk[]; report: Report }
```

Флоу: `readFileSync(AUDIENCE_PATH)` → `clean()` → парс секций → `AudienceChunk[]` → `writeChunkTree("audience", …)` + `writeReport`.

Правила парсинга:
1. Граница секции — `^##\s+` (H2): `emotion = emotionForSection(<текст после ##>)`.
2. Подзаголовок `^###\s+` (H3, напр. `13.1`, `Про время и нагрузку`) — закрывает текущую фразу, но **не** меняет emotion (остаётся emotion родительской секции).
3. Новая фраза — строка `^-\s+(.*)$`; текст после `- ` — начало фразы.
4. Продолжение — непустая строка без маркера (переносы внутри абзаца) → клеится к текущей фразе **пробелом**.
5. `---` (горизонтальная линия), `>`/`\>` (цитата), `**метки**`, `#`-заголовки — не фразы: закрывают текущую и игнорируются.
6. Пустое значение → фраза не создаётся.

**Подводный камень (реальные данные):** `clean()` де-экранирует только `#-~[]_` и `\`, а в `AUDIENCE.md` есть ещё `\*` (192), `\>` (1), `` \` `` (2). Чтобы в фразы не попадали остаточные backslash-escape, чанкер локально снимает их (`deescapeExtra`): `\*`→`*`, `\>`→`>`, `` \` ``→`` ` ``. Итог — markdown-акценты (`**+**`, `*(встречалось 2×)*`) остаются читаемыми, без `\`.

### Валидация — `audience/validate.ts` (только для audience)

```ts
export function validateChunk(chunk: AudienceChunk): Violation[]
export function validateSet(chunks: AudienceChunk[], expected?: number): Violation[]
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
| V6 | `emotion ∈ EMOTION_VALUES` или null | error |
| V7 | символ замены U+FFFD | error |
| V8 | доля кириллицы < 50% | warn |
| V9 | пустой `sourcePath` | error |

Структурные проверки: уникальность `id`. Счётчик **не форсится** (число фраз — фактическое); `expected` опционален и сверяется только если передан.

### Загрузчик — `audience/load.ts`

dry-run по умолчанию; `--apply` → `upsert` в `Chunk` через `withRetry(3)`. Требует `DATABASE_URL`.

Отличие upsert-данных: `{ type:"audience", text, emotion, sourcePath }` — **без `canPublish`/`depletion`**; `fearType`/`embedding` при создании `null` (дефолты схемы).

### Диспетчеры и гейт

```ts
// chunk.ts           → audience "audience" (ветка + runAudienceChunker)
// load.ts            → audience: () => import("./audience/load")  (dynamic import по типу)
// validate-chunks.ts → RUNNERS.audience = (c) => validateAudience(c as AudienceChunk[])  (exit 1 при errors)
```

## 4. UI

Не применимо — это пайплайн обработки данных.

## 5. Поток данных

```
docs/Facts:Case:Best/AUDIENCE.md
↓
runAudienceChunker() → parsePhrases() → clean() → AudienceChunk[]
↓
writeChunkTree("audience") → data/chunks/audience/<AUD-####>.json + _report.md
↓
validate-chunks.ts audience → validateSet() → exit 0 = можно грузить
↓
load.ts audience --apply → withRetry(prisma.chunk.upsert) → Postgres Chunk
```

Основные функции:
- `parsePhrases(raw)` — сырой текст → `[{ text, emotion }]` (секции → фразы).
- `emotionForSection(title)` — детерминированный маппинг секции в emotion.
- `deescapeExtra(text)` — снимает `\*`, `\>`, `` \` `` (которые `clean` не трогает).
- `toChunk(phrase, id, addedAt)` — фраза → `AudienceChunk` (`fearType/embedding = null`).
- `runAudienceChunker()` — собирает чанки, пишет дерево и отчёт.

## 6. Почему так, а не иначе

1. **Тот же per-type паттерн, что `fact`/`case`/`best`** (свой `chunk/load/validate/config` + строка в диспетчере): добавить новый тип = новый каталог, без правки существующих.
2. **1 фраза = 1 чанк** (а не карточка/пост): банк живого языка атомарен для RAG — каждый чанк ложится в вектор как отдельная формулировка.
3. **emotion детерминированно из секции**, а не LLM: воспроизводимо и детерминированно (одинаковый вход → одинаковый JSON); `fearType` (1–7) — LLM-проход позже.
4. **Локальный `deescapeExtra`** вместо правки общего `clean`: shared-слой не меняется (не задевает `fact`/`case`/`best`), а специфичные для источника `\*`/`\>`/`` \` `` снимаются точечно.
5. **Валидация отдельным гейтом** (`validate-chunks.ts`), а не внутри чанкера: проверяется результат, а не сам себя.
6. **Счётчик не форсим** — число фраз зависит от источника и меняется при добавлении комментариев; фиксируем только уникальность `id`.

## 7. Ограничения

- `fearType` и `embedding` — `null` (LLM/векторы — позже).
- `emotion` — best-effort по секции; секция «Дополнения/порции» → `прочее`.
- Много фраз — это норма (атомарность для RAG).
- Векторы — отдельная итерация.

## 8. Проверка (смоук)

- `npx tsx src/scripts/chunking/chunk.ts audience` → 338 JSON в `data/chunks/audience` + `_report.md`.
- `npx tsx src/scripts/chunking/validate-chunks.ts audience` → 0 errors, 0 warnings.
- `npx tsx src/scripts/chunking/load.ts audience` → dry-run (печатает план, не пишет).
- `npx tsx src/scripts/chunking/load.ts audience --apply` → 338 чанков в БД (`count = 338`).
- `fact`/`case`/`best` не затронуты (валидация OK); `typecheck` + `eslint` чисто.