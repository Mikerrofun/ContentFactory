---

**Дата:** 26.11.2026
**Теги:** #features #chunking #rag

---

## 1. Зачем

Исходник `docs/Facts:Case:Best/BEST.md` — 64 поста-эталона стиля (`VK-P-0001…0067` без `0016`, `0029`, `0035`) в сыром markdown с экранированием (`\##`, `\-`, `\~`, hard-break `\` в конце строк). Нарезать в RAG-чанки нельзя: заголовки и метаданные неоднородны (4 схемы), мусор в тексте, запись в БД должна быть воспроизводимой и безопасной. Нужен детерминированный пайплайн по тому же per-type паттерну, что и `fact`/`case`: очистка → нарезка → JSON → валидация → загрузка, изолированно от других типов. Бонусом переименовали тип чанка `voice` → `best` (концепт «голос автора» в `VOICE.md`/`VOICE_FINGERPRINT.md` не трогали — это другой смысл).

## 2. Где/что уже было

- Общий слой `lib/` (`clean/`, `fs/`, `types.ts`) и `src/shared/lib/net/with-retry.ts` — переиспользованы как есть.
- Эталон per-type реализации — `case/` (`chunk.ts` + `load.ts` + `validate.ts` + `config.ts`).
- Схема `prisma/schema.prisma`: модель `Chunk` с `type`, `text`, `pillar`, `format`, `sourcePath`, `sScheme`, `closingType`, `markers`.

Задача — не писать новую инфраструктуру, а добавить ещё один изолированный тип `best` по образцу `case` и переименовать enum-значение `voice`.

## 3. Реализация

### Переименование voice → best

- `prisma/schema.prisma`: enum `ChunkType` — `voice` → `best`.
- Миграция `20261127000000_rename_voice_to_best`: `ALTER TYPE "ChunkType" RENAME VALUE 'voice' TO 'best';` (БД была пуста по voice — безопасно).
- `lib/types.ts`: union `ChunkType` `voice`→`best`; добавлен `BestChunk`.
- Диспетчеры используют `best`. Концептуальные доки (`VOICE.md`, `VOICE_FINGERPRINT.md`, `chunks.md`) не трогали.

### Типы — `lib/types.ts`

```ts
export interface BestChunk {
  id: string;            // BEST-0001… (последовательный)
  type: "best";
  text: string;          // весь блок поста (метаданные + тело), очищенный — он же в вектор
  pillar: string | null; // строго один из PROOF/METHOD/TRUST/HUMAN (у всех 64 заполнен)
  format: string | null; // «Формат: …» из метаданных, иначе null
  sourcePath: string;    // путь к BEST.md
  sScheme: null;         // заполнит LLM позже
  closingType: null;     // заполнит LLM позже
  markers: null;         // заполнит LLM позже
  embedding: null;       // вектор — отдельная итерация
  addedAt: string;       // ISO
}
```

Отличия от `case`-чанка: **нет** `topic/depletion/cooldownUntil/fearClosed`; есть `format/sScheme/closingType/markers`. `id` — последовательный `BEST-####` (source-id `VK-P-####` только для отчёта, т.к. в источнике есть пропуски `0016/0029`).

### Конфиг — `best/config.ts` (FSD)

```ts
export const BEST_PATH = "docs/Facts:Case:Best/BEST.md";
export const SOURCE_BEST = "docs/Facts:Case:Best/BEST.md";
export const EXPECTED_BEST_COUNT = 64;
export const PILLAR_VALUES = ["PROOF","METHOD","TRUST","HUMAN"] as const;
export const HEADER_RE = /^##\s+\*\*POST\s+(VK-P-\d+)\b/;
export const PILLAR_LABEL_RE = /^(?:Пиллар|Pillar|PILLAR)\s*[:/]\s*(.*)$/i;
export const FORMAT_LABEL_RE = /^Формат\s*:\s*(.*)$/i;
export const PLACEHOLDER_RE = /заполнить|не удалось|не извлеч|недоступен|TODO/i;
```

### Чанкер — `best/chunk.ts`

```ts
export function parsePosts(raw: string): RawPost[]
export function runBestChunker(): { chunks: BestChunk[]; report: Report }
```

Флоу: `readFileSync(BEST_PATH)` → `clean()` → сплит по `HEADER_RE` на блоки → на каждый блок:
1. `id` = `BEST-0001…` по порядку.
2. `text` = весь блок (метаданные + тело), очищенный; markdown hard-break (`\` в конце строки) → перенос.
3. `pillar` = первое enum-слово из окна в 4 строки после метки `Пиллар/Pillar/PILLAR`; плейсхолдер в окне → `null`.
4. `format` = значение строки `Формат:` (или следующей, если пусто); плейсхолдер/пусто → `null`.
5. `sourcePath = SOURCE_BEST`; `sScheme/closingType/markers/embedding = null`; `addedAt` ISO.
→ `writeChunkTree("best", …)` + `writeReport`.

**Подводный камень (реальные данные):** метаданные гетерогенны, 4 схемы:
- `Платформа/Дата/Цель/Контекст/Метрика успеха` → `Текст поста:`;
- `Источник/URL/Дата/Тематика/Пиллар/Формат/Триггеры/Хуки/Заметки` → `Текст поста:`;
- англ. `SOURCE:/TAGS:/PILLAR / INTENT:/RAW TEXT:` (pillar на строке ниже метки);
- `Дата/Ссылка/Пиллар/Формат/Триггеры/Ключевая идея/CTA/Тэги` → `Текст поста:`.

Поэтому `text` = блок целиком (метаданные не парсятся поштучно — иначе 4 схемы не свести), а `pillar`/`format` извлекаются best-effort.

### pillar — строго 4 значения, у всех 64

Метки pillar в источнике были в разных формах (`Пиллар:`, `Пиллар (основной):`, `Пиллар(ы):`, `Группа/пиллар:`, `PILLAR / INTENT:`), а у части постов метки не было вовсе. Чтобы `pillar` был строго одним из `PROOF/METHOD/TRUST/HUMAN` у всех 64, исходный `BEST.md` нормализован: после заголовка каждого поста вставлена единая строка `Пиллар: <X>`. Значение определено **по содержимому каждого поста** (по `PILLARS.md`):
- **PROOF** — результаты/дело/артефакты (ученики, доход, кейсы, мой путь);
- **METHOD** — как делаю результат (рамки, разборы, инструкции, непопулярные мнения как метод, механики вовлечения);
- **TRUST** — ценности/границы/этика (что НЕ делаю, миссия, «кому не подойдёт», предупреждения о рисках);
- **HUMAN** — личность/путь/семья/«я из простых» (личные истории, рефлексия, окружение).

Чанкер читает эту метку (`pillarFromLabel`); `Цель`/эвристика/дефолт — только fallback. Итоговое распределение: HUMAN 31 / METHOD 18 / PROOF 8 / TRUST 7.

### Валидация — `best/validate.ts` (только для best)

Критерии V1–V9 (как у `case`): V1 остаточное экранирование, V2 HTML-теги, V3 двойные пробелы (warn), V4 trailing spaces (warn), V5 пустой `text`, V6 `pillar ∈ {PROOF,METHOD,TRUST,HUMAN} | null`, V7 U+FFFD, V8 кириллица <50% (warn), V9 пустой `sourcePath`. Структурно: уникальность `id`, счётчик = `EXPECTED_BEST_COUNT` (64).

### Загрузчик — `best/load.ts`

dry-run по умолчанию; `--apply` → `upsert` в `Chunk` через `withRetry(3)`. Upsert-данные: `{ type:"best", text, pillar, format, sourcePath }` — без `canPublish`, без `depletion` в `update`; `sScheme/closingType/markers/embedding` при создании `null`.

### Диспетчеры и гейт

```ts
// chunk.ts           → best "best" (ветка + runBestChunker)
// load.ts            → best: () => import("./best/load")  (dynamic import по типу)
// validate-chunks.ts → RUNNERS: { fact, case, best } (параметризован по типу, exit 1 при errors)
```

## 4. UI

Не применимо — это пайплайн обработки данных.

## 5. Поток данных

```
docs/Facts:Case:Best/BEST.md
↓
runBestChunker() → parsePosts() → clean() → BestChunk[]
↓
writeChunkTree("best") → data/chunks/best/<BEST-####>.json + _report.md
↓
validate-chunks.ts best → validateSet() → exit 0 = можно грузить
↓
load.ts best --apply → withRetry(prisma.chunk.upsert) → Postgres Chunk
```

Основные функции:
- `parsePosts(raw)` — сырой текст → `RawPost[]` (source-id + очищенный блок).
- `extractPillar(block)` / `extractFormat(block)` — best-effort из метаданных, плейсхолдеры → `null`.
- `toChunk(post, id, addedAt)` — `RawPost` → `BestChunk`.
- `runBestChunker()` — собирает чанки, пишет дерево и отчёт.

## 6. Почему так, а не иначе

1. **Тот же per-type паттерн, что `case`** (свой `chunk/load/validate/config` + строка в диспетчере): добавить тип = новый каталог, без правки существующих.
2. **Весь блок в `text`** (не дробим, метаданные не парсим поштучно): источник неоднороден (4 схемы), в вектор идёт цельный пост; отдельными полями — только `pillar/format` для фильтрации.
3. **`pillar`/`format` best-effort + плейсхолдеры → `null`**: часть метаданных не заполнена, enum-валидация не должна падать на этом.
4. **Валидация отдельным гейтом** (`validate-chunks.ts`), а не внутри чанкера: проверяется результат, а не сам себя.
5. **Load через прямой хост Neon (без `-pooler`)**: pooler + adapter даёт P1003; прямой эндпоинт работает.

## 7. Ограничения

- `sScheme`, `closingType`, `markers`, `embedding` — `null` (LLM/векторы — позже).
- `pillar` — строго один из 4, определён по содержимому и вписан в `BEST.md`; у всех 64 (null нет).
- `format` — best-effort (плейсхолдеры → `null`).
- Векторы — отдельная итерация.

## 8. Проверка (смоук)

- `npx tsx src/scripts/chunking/chunk.ts best` → 64 JSON в `data/chunks/best` + `_report.md`.
- `npx tsx src/scripts/chunking/validate-chunks.ts best` → 0 errors, 0 warnings.
- `npx tsx src/scripts/chunking/load.ts best` → dry-run (печатает план, не пишет).
- `load.ts best --apply` (direct host) → 64 чанков в БД: HUMAN 31 / METHOD 18 / PROOF 8 / TRUST 7 (null нет).
- `fact` (98) и `case` (68) не затронуты; `typecheck` + `eslint` чисто.