---

**Дата:** 27.11.2026
**Теги:** #features #chunking #embeddings #rag

---

## 1. Зачем

Чанки (624 шт.) нарезаны и лежат в БД, но без векторов — семантический поиск невозможен. Нужно добавить эмбеддинги ко всем типам чанков универсальным способом (по полному `text`, без разницы типа), хранить в БД (pgvector), без дублирования в JSON. Раньше эмбеддингов не было вообще: в JSON стояла заглушка `null`, в `Chunk` не было векторного поля, OpenRouter/pgvector в коде не задействованы.

## 2. Где/что уже было

- `src/shared/lib/net/with-retry.ts` — ретрай с `RetryableError`/`isRetryableStatus` (429/5xx). Переиспользован как есть, новый ретрай не писался.
- `src/db/prisma.ts` — singleton Prisma (driver adapter). Переиспользован.
- `src/config/env.ts` — zod-валидация env. Расширен, не переписан.
- `src/scripts/chunking/lib/fs` (`readChunkTree`) — чтение JSON-дерева для dry-run.
- `src/scripts/chunking/lib/types.ts` — `ChunkType` + новый `CHUNK_TYPES`.
- `pgvector@0.3.1` уже стоял в `package.json`, но не использовался.

Задача была не писать новую инфраструктуру, а добавить слой `lib/embed/` + один универсальный скрипт `embed.ts` и гейт `validate-embed.ts`.

## 3. Реализация

### Схема БД `prisma/schema.prisma` (модель `Chunk`)

Добавлено векторное поле + метаданные для skip-по-хэшу; удалён легаси `factText`. Type-specific `facts`/`factEmbeddings`/`factsUsed` оставлены (будущий `knowledge`).

```prisma
// prisma/schema.prisma
  chunkEmbedding  Unsupported("vector(4096)")?
  embeddingHash   String?
  embeddingModel  String?
  embeddingDims   Int?
```

Миграция `prisma/migrations/20261127010000_add_chunk_embedding/migration.sql` — рукописный SQL в стиле существующих: `CREATE EXTENSION vector`, drop `factText`, add вектора + метаданных. HNSW-индекс отложен (624 вектора — можно позже).

### Конфиг `src/config/env.ts` + `.env`

```ts
// src/config/env.ts
  OPENROUTER_API_KEY_EMBEDING: z.string().optional(),
  EMBEDDING_MODEL: z.string().default("qwen/qwen3-embedding-8b"),
  EMBEDDING_DIM: z.coerce.number().default(4096),
  EMBEDDING_INPUT_TYPE: z.string().default("search_document"),
  OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
```

### Reusable-слой `src/scripts/chunking/lib/embed/`

Подпапка с `types.ts` + `index.ts` баррелем (как `clean/`, `fs/`). Логика не хардкодит константы — берёт из `config`.

- `hash.ts` — `hashEmbedding(text, req)`: стабильный `sha256(text+model+inputType+dims)` → `embeddingHash`. Детерминирован: одинаковый вход → одинаковый хэш (нужно для skip).
- `openrouter.ts` — `embedBatch(texts, req)`: `POST ${BASE_URL}/embeddings`, `model`, `input: string[]`, `input_type`, `encoding_format: "float"`. Принимает массив строк + `EmbedRequest`, отдаёт `number[][]` (вектор на строку). 4xx/5xx → `RetryableError` для `withRetry`; прочие ошибки — обычный `Error`.
- `store.ts` — запись/чтение через `prisma.$executeRaw`/`$queryRaw` (Prisma не умеет `vector` нативно), каст `${literal}::vector`:
  - `getChunksNeedingEmbedding(type)` → `EmbeddingRow[]` (`id`, `text`, `embeddingHash`).
  - `upsertEmbedding(chunkId, vector, hash, model, dims)` → `UPDATE "Chunk" SET chunkEmbedding=…::vector, …` (текст не дублируется — он уже в `text`).
  - `countChunks(type)`, `getEmbeddingRow(id)`, `getVectorLength(id)` — для валидации.

### Универсальный скрипт `src/scripts/chunking/embed.ts`

CLI: `tsx … embed.ts [type|all] [--apply]`. Без `--apply` — dry-run (чтение из `data/chunks`, без БД/записи). Типы берутся из общего `CHUNK_TYPES`, не дублируются:

```ts
// src/scripts/chunking/embed.ts
import { CHUNK_TYPES } from "./lib/types";
const TYPES = CHUNK_TYPES;
```

Главные функции:
- `dryRunRows(type)` — читает `data/chunks/<type>` через `readChunkTree`, отдаёт `EmbeddingRow[]` с `embeddingHash: null` (для dry-run без БД).
- `runType(t)` — берёт строки (из БД при `--apply`, иначе dry-run), фильтрует по хэшу (skip, если `embeddingHash` совпал), батчами по 32 зовёт `embedBatch` c `withRetry` (attempts 5, backoff 1500ms — иначе OpenRouter 429), на каждый чанк считает хэш и `upsertEmbedding`. Принимает тип, отдаёт `{embedded, skipped, failed}`.
- `main()` — по `all` гоняет все `TYPES`, иначе один; сводка `embedded/skipped/failed`; `prisma.$disconnect()` в finally.

### Гейт `src/scripts/chunking/validate-embed.ts`

CLI: `tsx … validate-embed.ts [type]`. Проверяет: длина вектора = `EMBEDDING_DIM`, нет `NULL`, счётчик = числу чанков. Exit 1 при ошибках.

### `package.json`

```json
"embed": "tsx src/scripts/chunking/embed.ts",
"embed:validate": "tsx src/scripts/chunking/validate-embed.ts"
```

Остальная логика чанкинга/загрузки не тронута.

## 4. UI (если применимо)

Не применимо — CLI-скрипты.

## 5. Поток данных

```
embed.ts [type] --apply
↓ runType(t)
getChunksNeedingEmbedding(type) → SELECT id,text,embeddingHash FROM "Chunk" WHERE type=…  (EmbeddingRow[])
↓ фильтр по hashEmbedding(text,req)  (skip если embeddingHash совпал)
батчи по 32 → embedBatch(texts,req) → POST /embeddings → number[][]  (с withRetry 429/5xx)
↓ на чанк: hashEmbedding + upsertEmbedding(id, vector, hash, model, dims)
UPDATE "Chunk" SET chunkEmbedding=…::vector, embeddingHash/model/dims
↓ validate-embed.ts
getVectorLength(id)=EMBEDDING_DIM, нет NULL, count==чанков → OK/FAIL
```

## 6. Почему так, а не иначе

1. Хранение сразу в БД (pgvector), без дублирования в JSON — единый источник правды, вектор не раздувает файлы.
2. Универсальный `embed.ts` с аргументом типа вместо 5 отдельных скриптов — новый тип (`knowledge`) подключится тем же скриптом.
3. Метаданные `embeddingHash/Model/Dims` — чтобы skip-по-хэшу и воспроизводимость (повторный прогон не тратит токены).
4. `withRetry` + батч 32 + backoff 1500ms — OpenRouter режет большие батчи 429; переиспользован существующий ретрай, новый не писался.

## Преимущества

- ✅ Векторы у всех 624 чанков в БД, без дублирования в JSON.
- ✅ Идемпотентность: skip по хэшу, повторный прогон бесплатен.
- ✅ Один универсальный скрипт на все типы + `all`.
- ✅ Переиспользованы `withRetry`, `prisma`, `readChunkTree`, `env` — нового минимум.