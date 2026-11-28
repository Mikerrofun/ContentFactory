# Knowledge Chunking — план реализации (planDemands)

Статус: v2, на согласование. Делаем **сразу всё**: нарезка → валидация → загрузка → вектор чанка → LLM-поля (`facts`/`topic`) → векторы фактов. Поля `factsUsed`/износ — только заготовки (Этап 5, не сейчас).

## Требования к плану (planDemands)

1. **Основные файлы для изучения** — в начале (§0), чтобы агент понял проект и именно зону работ.
2. **Тесты** — в конце (§9), минимальные, не перегружать агента.
3. **Задачи — без кода.** Подробно описывать флоу и на что ссылаться (файлы/модули), а не приводить готовый код.
4. **Не просить документацию** — автор сделает её позже, после полного рефакторинга.
5. **FSD + типизация/конфиги отдельно.** Вся типизация — в файлах типов (`types.ts`), не вместе с логикой; конфиги/константы — в `config.ts`; не хардкодить в логике.
6. **Комментарии** — только на важных/первым взглядом непонятных местах (нарезка с перекрытием, «пусто = обработано»), не в каждом углу.

---

## 0. Основные файлы для изучения (перед работой)

- `docs/Features(steps)/Chunking/case/casePlan.md`, `case/CaseFeature.md` — эталон per-type.
- `docs/Features(steps)/Chunking/facts/FactsFeature.md`, `audience/audiencePlan.md`, `swipe/swipePlan.md` — ещё образцы.
- `docs/Features(steps)/Chunking/llm-content/llmContentPlan.md`, `llmContentFeature.md`, `llmContent.md` (§6 — `knowledge.facts`/`topic`).
- `docs/Features(steps)/Chunking/embeddings/embeddingPlan.md` — эмбеддинги (универсальный `embed.ts`).
- `src/scripts/chunking/case/{chunk,load,validate,config}.ts`, `case/llm-validating/{run,config,store,validate,types}.ts` — шаблон.
- `src/scripts/chunking/lib/clean/`, `lib/fs/`, `lib/types.ts` — общий слой.
- `src/scripts/chunking/lib/embed/{openrouter,store,hash,types,index}.ts` — клиент эмбеддингов + store.
- `src/scripts/chunking/lib/llm/{openrouter,with-fallback,config,concurrency,report,types,index}.ts` — клиент LLM + фоллбэк.
- `src/shared/lib/net/with-retry.ts` — общий ретрай.
- `src/scripts/chunking/{chunk,load,validate-chunks,embed,llm-validate,validate-embed}.ts` — диспетчеры/гейты.
- `prisma/schema.prisma` — модель `Chunk` (все нужные поля уже есть).
- `docs/Facts:Case:Best/KNOWLEDGE.md` — источник (проза, 8 абзацев, уже очищен автором).
- Справочник топиков (см. §3, `TOPIC_REFERENCE_PATH`) — файл со списком тем/ниш и их значений.

---

## 1. Цель

Нарезать сырой текст `KNOWLEDGE.md` в чанки `type = knowledge` скользящим окном по словам (блок 300–600 слов, перекрытие ~12–15% с предыдущим), записать JSON в `data/chunks/knowledge/`, провалидировать, загрузить в БД. Затем: эмбеддинг полного `text` (как у всех типов) + отдельный LLM-проход, который извлекает `facts` (3–7) и `topic`, и **в том же проходе** считает эмбеддинги фактов и пишет `factEmbeddings`. `factsUsed`/износ — не трогаем (заготовки под Этап 5).

---

## 2. Решения (согласованы)

| Вопрос | Решение |
|---|---|
| Источник | `docs/Facts:Case:Best/KNOWLEDGE.md`; `sourcePath` = он же у всех чанков |
| Единица нарезки | скользящее окно по словам, блок 300–600 (цель ~500), перекрытие ~12–15% с хвостом предыдущего |
| Ожидаемое число | ~10; **счётчик динамический, не фиксируем** (как у `audience`) |
| Очистка | `clean()` как у всех (файл уже чистый — прогон идемпотентен) |
| `id` | `KNOW-0001…` последовательный |
| `topic` | заполняет LLM; допустимы только темы из справочника, иначе `null` |
| `pillar`/`format` | `null` (knowledge — ядро, матчится по `topic`, не по pillar) |
| `facts` | LLM, 3–7 атомарных строк |
| `factEmbeddings` | LLM-проход сразу считает векторы фактов (та же модель/ключ `OPENROUTER_API_KEY_EMBEDING`), хранит как `number[][]` в Json-колонке |
| `factsUsed` | заготовка `null` (Этап 5); форма — массив, параллельный `facts` |
| `depletion` | **0 = свежий** (по формуле `(1−depletion)^α` и текущему `default 0`). ⚠️ В п.8 ответа было «1» — конфликт; ставим 0, см. §10 |
| Вектор чанка | полный `text` → `chunkEmbedding` (как у всех типов, через `embed.ts`) |
| Схема БД | **без миграции** — все поля уже есть (`topic/facts/factEmbeddings/factsUsed/depletion/chunkEmbedding/llm*`) |

---

## 3. Схема чанка `knowledge` (JSON)

| Поле | Тип | Источник / смысл |
|---|---|---|
| `id` | string PK | `KNOW-0001…` |
| `type` | `knowledge` | — |
| `text` | string | блок 300–600 слов с перекрытием, очищенный; он же в вектор |
| `topic` | string\|null | тема/ниша из справочника; LLM |
| `facts` | string[]\|null | 3–7 атомарных фактов; LLM |
| `factEmbeddings` | number[][]\|null | вектор на каждый факт (4096d); LLM-проход + embed-клиент |
| `factsUsed` | number[]\|null | заготовка под учёт (Этап 5), сейчас `null` |
| `sourcePath` | string | `docs/Facts:Case:Best/KNOWLEDGE.md` |
| `depletion` | number | `0` при создании (0 = свежий) |
| `embedding` | null | вектор чанка — только в БД (`chunkEmbedding`), в JSON `null` |

Ядро (изнашиваемое): `depletion` по фактам (Этап 5). Без `cooldown` (в отличие от `case`). Без `sourceUrl`.

---

## 4. Алгоритм нарезки (детерминированный, без LLM)

Скользящее окно по словам с перекрытием — настраивается в `knowledge/config.ts`:

- `BLOCK_MIN_WORDS = 300`, `BLOCK_MAX_WORDS = 600`, `BLOCK_TARGET_WORDS = 500`.
- `OVERLAP_RATIO = 0.12` (12–15% хвоста предыдущего блока → в начало следующего).
- `OVERLAP_WORDS = round(BLOCK_TARGET_WORDS · OVERLAP_RATIO)`; шаг = `BLOCK_TARGET_WORDS − OVERLAP_WORDS`.

Флоу:
1. `readFileSync(KNOWLEDGE_PATH)` → `clean()`.
2. Разбить на слова, сохраняя границы предложений/абзацев как приоритетные точки разрыва.
3. Идти окном: блок `[start, start+blockWords)`; `blockWords` близко к `BLOCK_TARGET_WORDS`, но не выходит за `MIN/MAX`; по возможности рвать по границе предложения рядом с целью; одиночное предложение длиннее `MAX` — резать по словам.
4. Следующий `start = start + blockWords − OVERLAP_WORDS` (хвост прошлого блока дословно попадает в начало следующего — это и есть «покрытие»).
5. Каждый блок → `KnowledgeChunk` (`id` = `KNOW-####`, `depletion = 0`, `topic/facts/factEmbeddings/factsUsed/embedding = null`).
6. `writeChunkTree("knowledge", chunks)` + `writeReport("knowledge", report)`.

Детерминизм: одинаковый вход → одинаковые блоки. Комментарий — только на перекрытии (неочевидно).

---

## 5. Схема БД

**Миграция не нужна.** В `Chunk` уже есть: `topic String?`, `facts Json?`, `factEmbeddings Json?`, `factsUsed Json?`, `depletion Float @default(0)`, `chunkEmbedding`, `embeddingHash/Model/Dims`, `llmProcessedAt/llmModel/llmPromptVersion`. `factEmbeddings` — `number[][]` в Json (векторное хранение, без отдельной колонки). `chunkEmbedding` — через pgvector, как у всех.

---

## 6. Задачи (флоу, без кода)

1. **Типы (FSD).** В `lib/types.ts` добавить `KnowledgeChunk`; `ChunkType` уже содержит `knowledge`. В `CHUNK_TYPES` **добавить `"knowledge"`** (чтобы `embed`/`embed all` и гейты видели тип).
2. **Конфиг.** `knowledge/config.ts`: `KNOWLEDGE_PATH`, `SOURCE_KNOWLEDGE`, `BLOCK_MIN_WORDS/MAX/TARGET`, `OVERLAP_RATIO`, `TOPIC_REFERENCE_PATH` (файл-справочник тем), `KNOWLEDGE_LLM_PROMPT_VERSION`. Ничего не хардкодить в логике.
3. **`knowledge/chunk.ts`.** Флоу из §4 → `KnowledgeChunk[]` → `writeChunkTree` + `writeReport`. Ссылки: `lib/clean`, `lib/fs`, `lib/types`, `knowledge/config`.
4. **`knowledge/validate.ts`.** Критерии V1–V9 (см. §7) + структура (уникальность `id`; счётчик динамический, без форса). Ссылки: `lib/clean` (`RESIDUAL_ESCAPE`), `lib/types`.
5. **`knowledge/load.ts`.** `readChunkTree<KnowledgeChunk>("knowledge")` → dry-run/`--apply` → `withRetry(prisma.chunk.upsert)` с `{ type:"knowledge", text, sourcePath, depletion:0 }` (`topic/facts/factEmbeddings/factsUsed` — `null`). `depletion` задавать **только при `create`** (в `update` не трогать, чтобы не сбрасывать износ при перезаливке). Ссылки: `shared/lib/net/with-retry`, `db/prisma`, `lib/fs`.
6. **Эмбеддинг чанка.** Ничего нового в `embed.ts` не требуется — после добавления `knowledge` в `CHUNK_TYPES` он подхватит тип автоматически (полный `text` → `chunkEmbedding`, skip по хэшу). Ссылки: `embed.ts`, `lib/embed/*`.
7. **`knowledge/llm-validating/`** (по образцу `case/llm-validating/`):
   - `types.ts` — `KnowledgeFill { facts: string[]; topic: string|null }`, `KnowledgeValidation`, `LlmChunkRow`, `KnowledgeRunOptions/Result`.
   - `config.ts` — системный/пользовательский промпт (RU): «извлеки 3–7 атомарных фактов и тему; тему — только из справочника, иначе null»; `TOPIC_REFERENCE_PATH` (передаём модели целиком); `FACTS_MIN=3`, `FACTS_MAX=7`.
   - `validate.ts` — чистая функция: `facts` — массив 3–7 непустых строк; `topic` ∈ набор тем справочника или `null`.
   - `store.ts` — `getChunksMissing(force)` (только `facts === null`, либо все при `--force`); `updateKnowledgeFields(id, {facts, factEmbeddings, topic}, meta)` через prisma (пишет `facts/factEmbeddings/topic` + `llmProcessedAt/llmModel/llmPromptVersion`).
   - `run.ts` — для каждого чанка: `text` + справочник → `chatJSONWithFallback` → `validate` (до 3 повторов) → **сразу** `embedBatch(facts, req)` (тот же `lib/embed`, ключ `OPENROUTER_API_KEY_EMBEDING`) → `factEmbeddings = number[][]` → `updateKnowledgeFields`. Dry-run — без БД; `--probe N` — N чанков с вызовом модели без записи; `--limit N`.
   - Комментарий — только на «пусто = обработано» и на «векторы фактов считаем здесь же».
8. **Диспетчеры.**
   - `chunk.ts` — ветка `knowledge` → `runKnowledgeChunker`.
   - `load.ts` — `knowledge: () => import("./knowledge/load")`.
   - `validate-chunks.ts` — `RUNNERS.knowledge` (динамический счётчик).
   - `llm-validate.ts` — добавить `"knowledge"` в `TYPES` и ветку `runKnowledgeLLM`.
9. **package.json** — новых скриптов не нужно (всё идёт через существующие `chunk`/`chunk:load`/`chunk:validate`/`embed`/`llm:validate`).

---

## 7. Валидации (`knowledge/validate.ts`)

- V1 остаточное экранирование — error
- V2 HTML/Markdown-теги — error
- V3 двойные пробелы — warn
- V4 пробелы в конце строки — warn
- V5 пустой `text` — error
- V6 размер блока 300–600 слов — warn вне диапазона (учитывает перекрытие)
- V7 U+FFFD — error
- V8 доля кириллицы < 50% — warn
- V9 пустой `sourcePath` — error
- Структура: уникальность `id`; счётчик динамический (не форсим).

---

## 8. Поток данных

```
KNOWLEDGE.md
  → runKnowledgeChunker: clean → окно 300–600 слов + перекрытие 12–15% → KnowledgeChunk[]
  → data/chunks/knowledge/KNOW-####.json + _report.md
  → validate-chunks knowledge (exit 1 при errors)
  → chunk:load knowledge --apply → upsert {type,text,sourcePath,depletion:0}
  → embed knowledge --apply → chunkEmbedding (полный text, skip по хэшу)
  → llm:validate knowledge --apply → facts + topic (LLM) → embedBatch(facts) → factEmbeddings
```

Порядок: `chunk → validate → load → embed` (вектор чанка) и `llm:validate` (факты+тема+векторы фактов). `embed` и `llm:validate` независимы; `llm:validate` сам считает векторы фактов.

---

## 9. Тесты (минимальные, в конце)

- Смоук: `chunk knowledge` → JSON в `data/chunks/knowledge`; `validate-chunks knowledge` → 0 errors.
- Юнит: длинный текст → блоки 300–600 слов, у соседних блоков есть перекрытие, у каждого непустой `text`.
- Load dry-run: печатает план, не пишет.
- LLM dry-run/`--probe 1`: печатает план/вывод, в БД не пишет.
- Не перегружать: без интеграционных тестов на все поля.

---

## 10. Ограничения / открытые допущения

- **`depletion` при создании = 0** (0 = свежий). В п.8 ответа было «1» — это конфликт с п.17 и формулой веса; принято 0. **Подтвердить перед реализацией.**
- **Файл-справочник топиков** (`TOPIC_REFERENCE_PATH`) — prerequisite: автор создаёт/подтверждает путь (в репо пока нет отдельного файла тем; `PILLARS.md` — про пиллары, не темы).
- **Число чанков** — эмерджентное из параметров окна; ~10 ожидаемо, но не форсится.
- `factsUsed`/износ — не реализуем (Этап 5).
- Векторы фактов — только в `factEmbeddings` (Json), pgvector-поиск по фактам — не в этой итерации.