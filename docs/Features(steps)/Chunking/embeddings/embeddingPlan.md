# Embedding Plan — векторы для всех типов чанков (Qwen3 Embedding 8B / OpenRouter)

Статус: черновик v1, на согласование.
Цель: добавить эмбеддинги (векторы) к каждому чанку универсальным паттерном (по полному `text`, без разницы типа), хранение — в БД (pgvector), без дублирования в JSON.

---

## planDemands (требования к реализации)

1. **Основные файлы для изучения** — в начале (см. §0.1), чтобы агент понял проект и именно зону работ.
2. **Тесты** — в конце, минимальные, не перегружать агента (см. §9).
3. **Задачи — без кода.** Подробно описывать флоу и на что ссылаться (файлы/модули), а не приводить готовый код.
4. **Не просить документацию** — автор сделает её позже, после полного рефакторинга.
5. **FSD + типизация/конфиги отдельно.** Вся типизация — в файлах типов (`types.ts`), не вместе с логикой; конфиги/константы — в `config.ts`; не хардкодить в логике.
6. **Комментарии** — только на важных/первым взглядом непонятных местах, не в каждом углу.

---

## 0.1 Основные файлы для изучения (перед работой)

- `src/scripts/chunking/lib/types.ts` — общие типы чанков (куда добавлять типы эмбеддингов).
- `src/scripts/chunking/lib/fs/fs.ts` — generic read/write дерева чанков.
- `src/scripts/chunking/lib/clean/` — общая очистка текста.
- `src/scripts/chunking/chunk.ts`, `load.ts`, `validate-chunks.ts` — диспетчеры и гейт (образец структуры скрипта).
- `src/scripts/chunking/fact/{chunk,load,validate}.ts` — эталон per-type флоу (чанкер + загрузчик + валидатор).
- `src/shared/lib/net/with-retry.ts` — общий ретрай (переиспользуем для 429/5xx).
- `src/db/prisma.ts` — singleton Prisma (driver adapter).
- `src/config/env.ts` — zod-валидация env (куда добавлять ключи).
- `prisma/schema.prisma` — модель `Chunk` (type, text, facts/factEmbeddings/factsUsed, factText, chunkEmbedding).
- `prisma/migrations/*/migration.sql` — образец рукописной миграции.
- `package.json` — скрипты (`chunk`, `chunk:load`, `chunk:validate`) и зависимости (`pgvector`, `openai`).
- `data/chunks/<type>/*.json` — фактические чанки (универсальный `text`).

---

## 0. Контекст и находки (проверено по коду)

- **Реальный путь reusable-кода:** `src/scripts/chunking/lib/` (`clean/`, `fs/`, `types.ts`). Папки `features/src/lib/chunking` в проекте нет.
- **Уже нарезаны (JSON в `data/chunks/<type>/`):** fact 98, case 68, best 64, audience 338, swipe 56 = **624 чанка**. `knowledge` ещё не нарезан.
- Каждый чанк имеет поле `text`; `embedding` в JSON — заглушка `null` (в fact JSON поля `embedding` даже нет).
- **Prisma `Chunk`:** векторного поля нет.
  - `facts Json?` / `factEmbeddings Json?` / `factsUsed Json?` — **type-specific для будущего `knowledge`** (генерятся из текста при индексации: 3–7 атомарных фактов, их эмбеддинги, флаги износа). **ОСТАВЛЯЕМ, не трогаем.**
  - `factText String?` — **легаси**, удаляем миграцией.
  - Основное векторное поле — `chunkEmbedding` (добавляем). Текст не дублируем — он уже в `Chunk.text`.
- `pgvector@0.3.1` уже в `package.json`, но не задействован. OpenRouter/embedding-кода в `src` нет.
- **Миграции:** рукописные SQL в `prisma/migrations/<timestamp>_<name>/migration.sql` (пример: `20261127000000_rename_voice_to_best`). `db:migrate` = `prisma migrate dev`, `db:push` = `prisma db push`.
- **Env:** `OPENROUTER_API_KEY_EMBEDING` задан и валиден; `EMBEDDING_MODEL="text-embedding-3-small"` (меняем); `src/config/env.ts` — zod-валидация.
- **OpenRouter (проверено):** `POST https://openrouter.ai/api/v1/embeddings`, OpenAI-совместимый, batch (массив строк), модель `qwen/qwen3-embedding-8b`, дефолт **4096** dims, `input_type` поддержан, цена ~$0.01/M токенов.
- **Swipe проверен:** `text` = вся карточка целиком, включая разбор (`WHY_IT_WORKS`, `STRUCTURE`, `PATTERNS_TO_BORROW`, `DO_NOT_COPY`, `ROMAN_ADAPTATION_NOTE`). Отдельные поля — структурные дубликаты, **всё уже в `text`**. Доп. поля в вектор добавлять не нужно.

---

## 1. Решения (согласованы)

| Вопрос | Решение |
|---|---|
| Путь reusable-кода | `src/scripts/chunking/lib/` |
| Типы | все 5 готовых (fact, case, best, audience, swipe) |
| Хранение | сразу в БД (pgvector), без дублирования в JSON |
| Поле | `facts`/`factEmbeddings`/`factsUsed` — **оставляем** (type-specific для `knowledge`). Удаляем легаси `factText`. Добавляем основное `chunkEmbedding` (вектор) + метаданные. Текст не дублируем (уже в `text`). |
| Размерность | 4096 (полная, без MRL-усечения) |
| vectorText | полный `text` (уже подобран; поля типов внутри `text`; swipe проверен) |
| Модель | `qwen/qwen3-embedding-8b` + OpenRouter |
| input_type | `search_document` |
| Форма скрипта | универсальный `embed.ts` с аргументом типа |
| Режим | dry-run по умолчанию + `--apply`, skip по хэшу текста |
| Батчинг | батч 64, `withRetry` (есть в проекте), concurrency 1–2 |
| Валидация | длина = dim, отсутствие null, счётчик + smoke |

Доп. решение (нужно для skip-по-хэшу и воспроизводимости): добавить в `Chunk` поля `embeddingHash String?`, `embeddingModel String?`, `embeddingDims Int?`. Если не нужно — убрать, но тогда skip по хэшу хранить негде.

---

## 2. Схема БД и миграция

### 2.1 `prisma/schema.prisma` (модель `Chunk`)
- Оставить как есть (type-specific для `knowledge`): `facts Json?`, `factEmbeddings Json?`, `factsUsed Json?`.
- Удалить легаси: `factText String?`.
- Добавить:
  ```prisma
  chunkEmbedding   Unsupported("vector(4096)")?  // основной вектор
  embeddingHash    String?
  embeddingModel   String?
  embeddingDims    Int?
  ```
- Индекс (HNSW, cosine) — добавим в этой же миграции или отложим (см. §8, вопрос).

### 2.2 Новая миграция `prisma/migrations/<ts>_add_chunk_embedding/migration.sql`
Рукописный SQL в стиле существующих:
```sql
-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Drop legacy field
ALTER TABLE "Chunk" DROP COLUMN IF EXISTS "factText";

-- Add vector + metadata (всем типам)
ALTER TABLE "Chunk"
  ADD COLUMN "chunkEmbedding" vector(4096),
  ADD COLUMN "embeddingHash" TEXT,
  ADD COLUMN "embeddingModel" TEXT,
  ADD COLUMN "embeddingDims" INTEGER;

-- (опционально) HNSW-индекс под косинус
-- CREATE INDEX "Chunk_chunkEmbedding_idx" ON "Chunk"
--   USING hnsw ("chunkEmbedding" vector_cosine_ops);
```
Применение: `prisma migrate deploy` (или `prisma db execute`), затем `prisma generate`.
Примечание: `Unsupported("vector(4096)")` — Prisma не умеет читать/писать vector нативно; запись/чтение — через `$executeRaw`/`$queryRaw` (§5).

---

## 3. Конфиг / env

### 3.1 `.env`
- `EMBEDDING_MODEL="qwen/qwen3-embedding-8b"`
- `EMBEDDING_DIM=4096`
- `EMBEDDING_INPUT_TYPE=search_document`
- `OPENROUTER_API_KEY_EMBEDING` — уже задан.
- (опц.) `OPENROUTER_BASE_URL=https://openrouter.ai/api/v1`

### 3.2 `src/config/env.ts` (zod)
Добавить/обновить:
```ts
OPENROUTER_API_KEY_EMBEDING: z.string().optional(),
EMBEDDING_MODEL: z.string().default("qwen/qwen3-embedding-8b"),
EMBEDDING_DIM: z.coerce.number().default(4096),
EMBEDDING_INPUT_TYPE: z.string().default("search_document"),
OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
```

---

## 4. Reusable lib — `src/scripts/chunking/lib/embed/`

- `types.ts` — `EmbedRequest`, `EmbedResult`, `EmbeddingRow`, `EmbedRunOptions`.
- `hash.ts` — стабильный `sha256(text + model + input_type + dims)` → `embeddingHash`.
- `openrouter.ts` — клиент эмбеддингов:
  - `embedBatch(texts: string[]): Promise<number[][]>` — `POST ${BASE_URL}/embeddings`, `model`, `input: string[]`, `input_type`, `encoding_format: "float"`, `dimensions` не передаём (полная 4096).
  - Bearer `OPENROUTER_API_KEY_EMBEDING`; опц. `HTTP-Referer`/`X-Title`.
  - Ошибки 4xx/5xx → `RetryableError` (переиспользуем `shared/lib/net/with-retry`).
- `store.ts` — запись в БД через `prisma.$executeRaw` (pgvector):
  - `upsertEmbedding(chunkId, vector, hash, model, dims)` — `UPDATE "Chunk" SET "chunkEmbedding" = $1::vector, "embeddingHash" = $2, ... WHERE id = $3`.
  - `getChunksNeedingEmbedding(type)` — `SELECT id, text, "embeddingHash" FROM "Chunk" WHERE type = $1`.
  - Вектор передавать строкой `[... ]::vector` (или через `pgvector.toSql`).
- `index.ts` — реэкспорт.

---

## 5. Универсальный скрипт `src/scripts/chunking/embed.ts`

CLI: `tsx src/scripts/chunking/embed.ts [type] [--apply]` (type: fact|case|best|audience|swipe|all).

Поток:
1. Прочитать env/конфиг.
2. Если `--apply` — получить из БД чанки типа (id, text, embeddingHash); иначе — dry-run на первых N из `data/chunks/<type>` (без БД).
3. Отфильтровать: skip, если `embeddingHash` совпадает с текущим (идемпотентность).
4. Батчами по 64: `embedBatch(texts)` c `withRetry` (attempts 3, backoff).
5. Для каждого чанка: `hash = sha256(text+model+input_type+dims)`, `upsertEmbedding(...)` (в `--apply`).
6. Логи: прогресс `done/total`, сводка (embedded/skipped/failed).
7. `prisma.$disconnect()` в finally.

Предпосылка: чанки должны быть в БД → сначала `chunk:load --apply` для всех 5 типов. Embed пишет в существующие строки `Chunk` (по `id`). Если строки нет — либо ошибка, либо minimal-upsert (решить, §8).

package.json: добавить `"embed": "tsx src/scripts/chunking/embed.ts"`.

---

## 6. Валидация — `src/scripts/chunking/validate-embed.ts`

CLI: `tsx ... validate-embed.ts [type]`. Проверки:
- длина каждого вектора = `EMBEDDING_DIM` (4096);
- нет `null`/пустых векторов;
- счётчик совпадает с числом чанков типа;
- smoke: 1 тип, 1 чанк, ручная сверка.
Exit 1 при ошибках. Можно встроить в `embed.ts --apply` как пост-проверку.

---

## 7. Порядок выполнения (команды)

1. `prisma migrate deploy` (или `db:push`) + `prisma generate`.
2. `npm run chunk:load -- fact|case|best|audience|swipe --apply` (если ещё не в БД).
3. `npm run embed fact` (dry-run) → проверить план.
4. `npm run embed fact -- --apply` → smoke на 1 типе.
5. `npm run validate-embed fact`.
6. Повторить для остальных типов / `embed all --apply`.
7. `npm run lint && npm run typecheck`.

---

## 8. Открытые вопросы / риски

1. **Метаданные хэша:** добавляем `embeddingHash/embeddingModel/embeddingDims` (нужно для skip-по-хэшу) или храним иначе?
2. **HNSW-индекс** создаём сейчас или откладываем (624 вектора — можно позже)?
3. **Отсутствие строки Chunk:** embed падает с ошибкой или делает minimal-upsert (создаёт строку с `type/text`)?
4. **Источник текста:** читаем `text` из БД (после load) или из `data/chunks` JSON? (предлагаю из БД — раз пишем в БД).
5. **knowledge:** пока не нарезан — пропускаем (добавим позже тем же универсальным скриптом).
6. **Стоимость:** 624 чанка × ~средний текст — копейки (~$0.01/M), но подтвердить бюджет на прогон.

---

## 9. Тесты (минимальные, в конце)

- Смоук: `embed fact` (dry-run) печатает план без записи; `embed fact -- --apply` → 1 тип обработан; `validate-embed fact` → 0 ошибок.
- Юнит (1–2): `hash.ts` детерминирован (одинаковый вход → одинаковый хэш); длина вектора = `EMBEDDING_DIM`.
- Load-предпосылка: без строк в БД embed сообщает об ошибке/пропуске (по решению §8.3).
- Не перегружать: без развёрнутых интеграционных тестов на все 5 типов.