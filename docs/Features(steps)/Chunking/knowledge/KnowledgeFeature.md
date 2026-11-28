---

**Дата:** 28.11.2026
**Теги:** #features #chunking #rag

---

## 1. Зачем

`KNOWLEDGE.md` — прозаический источник (биография/путь/бизнес Романа Пузата, 8 абзацев, ~1109 слов). Это **ядро-сырьё**, из которого потом собираются посты: «знания» — главный, самый большой источник, они «тратятся» по мере расходования фактов (см. `chunkPresentation.md`). В RAG такой текст нельзя класть куском: он не бьётся на检索-единицы, а факты внутри не адресуемы. Нужен детерминированный пайплайн по тому же per-type паттерну, что `fact`/`case`: очистка → нарезка → JSON → валидация → загрузка, плюс LLM-извлечение `facts`/`topic` и векторов фактов. `pillar`/`format` у knowledge **не заполняем** — это «база», она матчится по `topic`, а не по пиллару (и по природе multi-pillar).

## 2. Где/что уже было

Задача была **не писать новую инфраструктуру, а переиспользовать существующую** и добавить ещё один изолированный тип `knowledge` по образцу `case`.

- Общий слой `lib/` — `clean/`, `fs/`, `types.ts` (generic `readChunkTree/writeChunkTree/writeReport`).
- LLM-клиент `lib/llm/` — `chatJSONWithFallback`, `mapLimit`, `writeLlmReport`, `VALIDATE_ATTEMPTS`.
- Эмбеддинги `lib/embed/` — `embedBatch`, `hashEmbedding`, `EmbedRequest` (ключ `OPENROUTER_API_KEY_EMBEDING`).
- Ретрай `shared/lib/net/with-retry` — `withRetry`.
- Схема `prisma/schema.prisma` — модель `Chunk` уже содержит `topic/facts/factEmbeddings/factsUsed/depletion/chunkEmbedding/llm*`. **Миграция не нужна.**

Ключевой существующий кусок — универсальный эмбеддинг, который подхватывает тип автоматически после добавления `knowledge` в `CHUNK_TYPES`:

```ts
// src/scripts/chunking/embed.ts
const TYPES = CHUNK_TYPES; // теперь включает "knowledge"
// полный text → chunkEmbedding, skip по хэшу (hashEmbedding)
```

## 3. Реализация

### Типы — `lib/types.ts`

Добавлен `KnowledgeChunk` (типизация живёт в файле типов, не в логике). `ChunkType` уже содержал `knowledge`; в `CHUNK_TYPES` добавлен `"knowledge"`, чтобы `embed`/`embed all` и гейты видели тип.

```ts
// src/scripts/chunking/lib/types.ts
export interface KnowledgeChunk {
  id: string;                       // KNOW-0001…
  type: "knowledge";
  text: string;                     // блок 300–600 слов с перекрытием — он же в вектор
  topic: string | null;             // тема из справочника; LLM
  facts: string[] | null;           // 3–7 атомарных фактов; LLM
  factEmbeddings: number[][] | null;// вектор на каждый факт (4096d); LLM-проход
  factsUsed: number[] | null;       // заготовка под учёт (Этап 5), сейчас null
  sourcePath: string;               // docs/Facts:Case:Best/KNOWLEDGE.md
  depletion: number;                // 0 = свежий
  embedding: null;                  // вектор чанка — только в БД (chunkEmbedding)
}
```

### Конфиг — `knowledge/config.ts` (FSD)

Ничего не хардкодится в логике — всё отсюда:

```ts
// src/scripts/chunking/knowledge/config.ts
export const KNOWLEDGE_PATH = "docs/Facts:Case:Best/KNOWLEDGE.md";
export const SOURCE_KNOWLEDGE = "docs/Facts:Case:Best/KNOWLEDGE.md";
export const TOPIC_REFERENCE_PATH = "docs/Facts:Case:Best/TOPICS.md";
export const BLOCK_MIN_WORDS = 300;
export const BLOCK_MAX_WORDS = 600;
export const BLOCK_TARGET_WORDS = 500;
export const OVERLAP_RATIO = 0.12;
export const OVERLAP_WORDS = Math.round(BLOCK_TARGET_WORDS * OVERLAP_RATIO); // 60
export const KNOWLEDGE_LLM_PROMPT_VERSION = "knowledge-llm-v1";
export const KNOWLEDGE_TOPICS = ["контентные сайты","монетизация","обучение","трафик",
  "делегирование","предпринимательство","реинвестирование","личный бренд"] as const;
```

### Чанкер — `knowledge/chunk.ts`

Флоу: `readFileSync(KNOWLEDGE_PATH)` → `clean()` → `tokenize()` → `chunkByWindow()` → `KnowledgeChunk[]` → `writeChunkTree` + `writeReport`.

Главные функции:

- `tokenize(text): WordToken[]` — принимает очищенный текст, отдаёт слова с флагами `endSentence`/`endParagraph` (приоритетные точки разрыва).
- `findBoundary(tokens, minEnd, maxEnd, targetEnd): number | null` — ищет ближайшую к цели границу предложения/абзаца в диапазоне `[minEnd, maxEnd]`; `null` → режем по словам.
- `chunkByWindow(tokens): string[]` — скользящее окно: блок `[start, end)` близко к `BLOCK_TARGET_WORDS`, но в `[MIN, MAX]`; следующий `start = start + blockWords − OVERLAP_WORDS` (хвост прошлого блока дословно в начало следующего — это и есть «покрытие»).
- `runKnowledgeChunker(): { chunks, report }` — собирает `KNOW-####`, `depletion=0`, `topic/facts/factEmbeddings/factsUsed/embedding=null`, пишет дерево и отчёт.

```ts
// src/scripts/chunking/knowledge/chunk.ts
// Перекрытие: хвост прошлого блока (OVERLAP_WORDS слов) дословно попадает
// в начало следующего — это и есть «покрытие» темы.
const step = Math.max(1, end - start - OVERLAP_WORDS);
start += step;
```

### Валидация — `knowledge/validate.ts`

Критерии V1–V9 + структура (уникальность `id`; счётчик **динамический**, без форса). `validateChunk(chunk)`, `validateSet(chunks)`, `summarize(violations)`. V6 — размер блока 300–600 слов (warn вне диапазона, с учётом перекрытия).

### Загрузчик — `knowledge/load.ts`

dry-run по умолчанию; `--apply` → `upsert` через `withRetry(3)`. `depletion=0` задаётся **только при `create`** (в `update` не трогаем, чтобы не сбрасывать износ при перезаливке). `topic/facts/factEmbeddings/factsUsed` при create не задаём — в БД уже `null` по умолчанию.

```ts
// src/scripts/chunking/knowledge/load.ts
const data = { type: "knowledge" as const, text: c.text, sourcePath: c.sourcePath };
prisma.chunk.upsert({
  where: { id: c.id },
  update: data,
  create: { id: c.id, ...data, depletion: 0 },
});
```

### LLM-проход — `knowledge/llm-validating/`

По образцу `case/llm-validating/`. `facts` + `topic` + **сразу** векторы фактов в одном проходе.

- `config.ts` — RU-промпт «извлеки 3–7 атомарных фактов и тему; тему — только из справочника, иначе null»; `TOPIC_REFERENCE_PATH` (передаём модели целиком); `FACTS_MIN=3`, `FACTS_MAX=7`; `ALLOWED_TOPICS` (whitelist из `KNOWLEDGE_TOPICS`).
- `validate.ts` — `validateKnowledgeAnswer(answer)`: `facts` — массив 3–7 непустых строк; `topic` ∈ набор тем справочника или `null`.
- `store.ts` — `getChunksMissing(force)` (только `facts === null`, либо все при `--force`); `updateKnowledgeFields(id, {facts, factEmbeddings, topic}, meta)` пишет поля + `llmProcessedAt/llmModel/llmPromptVersion`.
- `run.ts` — `fillOne(row, reference)` (до `VALIDATE_ATTEMPTS` запросов, пока не пройдёт валидацию); `runKnowledgeLLM(opts)` — для каждого чанка: `text` + справочник → `chatJSONWithFallback` → `validate` → `embedBatch(facts, req)` → `factEmbeddings = number[][]` → `updateKnowledgeFields`. Dry-run без БД; `--probe N` — N чанков с вызовом модели без записи; `--limit N`.

```ts
// src/scripts/chunking/knowledge/llm-validating/run.ts
// Векторы фактов считаем здесь же (тот же embed-клиент, ключ OPENROUTER_API_KEY_EMBEDING).
const factEmbeddings = await withRetry(() => embedBatch(res.value.facts, EMBED_REQ), { attempts: 3 });
await updateKnowledgeFields(row.id, { ...res.value, factEmbeddings },
  { model: res.model, version: KNOWLEDGE_LLM_PROMPT_VERSION });
```

### Диспетчеры

```ts
// src/scripts/chunking/chunk.ts            → case "knowledge" (ветка + runKnowledgeChunker)
// src/scripts/chunking/load.ts             → knowledge: () => import("./knowledge/load")
// src/scripts/chunking/validate-chunks.ts  → RUNNERS.knowledge (динамический счётчик)
// src/scripts/chunking/llm-validate.ts     → TYPES += "knowledge", ветка runKnowledgeLLM
```

`package.json` не менялся — всё идёт через существующие `chunk`/`chunk:load`/`chunk:validate`/`embed`/`llm:validate`.

### Что НЕ тронуто

- `pillar`/`format` — остаются `null` (решение: knowledge — база, матчится по `topic`).
- `factsUsed`/износ — заготовка `null` (Этап 5).
- Схема БД — без миграции.
- `embed.ts` — правок логики нет (тип подхватился через `CHUNK_TYPES`).

## 4. UI (если применимо)

Не применимо — это пайплайн обработки данных.

## 5. Поток данных

```
KNOWLEDGE.md
↓ runKnowledgeChunker: clean → tokenize → chunkByWindow (300–600 слов, перекрытие 60)
↓ KnowledgeChunk[] (KNOW-####, topic/facts/factEmbeddings/factsUsed/embedding = null, depletion = 0)
↓ writeChunkTree → data/chunks/knowledge/KNOW-####.json + _report.md
↓ validate-chunks knowledge (exit 1 при errors)
↓ chunk:load knowledge --apply → upsert { type, text, sourcePath, depletion:0 }
↓ embed knowledge --apply → chunkEmbedding (полный text, skip по хэшу)
↓ llm:validate knowledge --apply → facts + topic (LLM) → embedBatch(facts) → factEmbeddings
```

Основные функции (что принимают / что отдают / зачем):

- `tokenize(text)` — текст → `WordToken[]` (слова + границы); зачем: приоритетные точки разрыва для окна.
- `chunkByWindow(tokens)` — токены → `string[]` (блоки с перекрытием); зачем: детерминированная нарезка ядра.
- `runKnowledgeChunker()` — файл → `{ chunks, report }` + запись дерева; зачем: собрать JSON-чанки.
- `validateSet(chunks)` — чанки → `Violation[]`; зачем: гейт перед загрузкой.
- `load main()` — JSON-дерево → upsert в `Chunk`; зачем: залить ядро в БД (depletion только на create).
- `fillOne(row, ref)` — `(id,text)` → `{ facts, topic } | error`; зачем: один чанк через LLM с валидацией.
- `runKnowledgeLLM(opts)` — опции → `{ total, filled, failed, ... }`; зачем: facts+topic+векторы фактов за один проход.

## 6. Почему так, а не иначе

1. **Тот же per-type паттерн, что `fact`/`case`** (свой `chunk/load/validate` + строка в диспетчере): новый тип = новый каталог, без правки существующих.
2. **Скользящее окно по словам с перекрытием 12%**, детерминированно, с разрывом по границам предложений/абзацев — покрытие темы и воспроизводимость (одинаковый вход → одинаковые блоки).
3. **Счётчик динамический** (источник 1109 слов → 3 чанка), а не фиксированный «~10»: число эмерджентно из параметров окна.
4. **`depletion=0` (0 = свежий) только в `create`**: перезаливка не сбрасывает накопленный износ.
5. **`facts`+`topic`+`factEmbeddings` в одном LLM-проходе** (`embedBatch` фактов здесь же): один проход вместо отдельной итерации векторов.
6. **`pillar`/`format` не заполняем**: knowledge — база/сырьё, матчится по `topic`; один чанк часто multi-pillar, жёсткий пиллар терял бы смысл.
7. **Load через прямой хост Neon (без `-pooler`)**: pooler + driver adapter даёт P1003 (`Database "admin" does not exist`); прямой эндпоинт работает.
8. **Без миграции**: все поля (`topic/facts/factEmbeddings/factsUsed/depletion/chunkEmbedding/llm*`) уже есть в `Chunk`.

## Преимущества

- ✅ Детерминированная нарезка: одинаковый вход → одинаковые JSON.
- ✅ Перекрытие 12% — соседние блоки покрывают тему, факты не рвутся на границе.
- ✅ Один LLM-проход на `facts` + `topic` + векторы фактов.
- ✅ Эмбеддинг чанка — skip по хэшу (повторный прогон не тратит запросы).
- ✅ Тип изолирован: свой `chunk/load/validate` + строка в диспетчере.
- ✅ Без миграции БД и без правок `embed.ts`.