---

**Дата:** 27.11.2026
**Теги:** #features #chunking #llm

---

## 1. Зачем

После нарезки LLM-поля чанков оставались `null`: `case.fearClosed`, `best.sScheme/closingType/markers`, `audience.fearType`. Без них не работают слоты сборки бандла (доказательство под страх, voice-эталоны, узнавание) и метрики `adaptability`/`human_factor`/`Structure Repetition`.

Заполнять их вручную нельзя — 167 чанков. Нужен был повторяемый прогон: строгий JSON от модели, валидация по словарям, запись только нужного поля, dry-run по умолчанию и отчёт. Плюс дешёвый детерминированный путь для маркеров, где модель стабильно возвращает пустоту.

## 2. Где/что уже было

Задача была не писать новое, а переиспользовать существующий слой:

- `src/shared/lib/net/with-retry.ts` — ретраи и `RetryableError` (429/5xx). Новый код ретраев не писался.
- `src/config/env.ts` — `LLM_MODEL`, `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`; добавлены `LLM_FALLBACK_MODEL`, `LLM_TEMPERATURE`, `LLM_CONCURRENCY`.
- `src/scripts/chunking/lib/embed/openrouter.ts` — образец клиента OpenRouter; `lib/embed/store.ts` — образец «читать/писать через prisma».
- `src/scripts/chunking/lib/fs` (`readChunkTree`) — чтение чанков для dry-run.
- `src/scripts/chunking/lib/types.ts` — общие типы чанков.
- `prisma` singleton `src/db/prisma.ts`.

Ключевой переиспользованный кусок — ретрай:

```ts
// src/shared/lib/net/with-retry.ts (переиспользуется как есть)
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, options: WithRetryOptions = {}): Promise<T>
```

## 3. Реализация

### 3.1 Общий клиент `lib/llm/`

Единственное общее между типами. Всё остальное — per-type.

```ts
// src/scripts/chunking/lib/llm/openrouter.ts
export async function chatJSON<T = unknown>(messages: ChatMessage[], opts: ChatJSONOptions = {}): Promise<T>
// POST ${BASE_URL}/chat/completions, response_format=json_object,
// temperature=LLM_TEMPERATURE, max_tokens=opts.maxTokens ?? LLM_MAX_TOKENS.
// 429/5xx → RetryableError; невалидный JSON → Error.
```

```ts
// src/scripts/chunking/lib/llm/with-fallback.ts
export async function chatJSONWithFallback<T = unknown>(
  messages: ChatMessage[],
  opts: ChatJSONOptions = {},
  deps: FallbackDeps = {},
): Promise<ChatJSONResult<T>>
// { data, model, fallback }. deps.primary/deps.fallback — для тестов (мок).
// Основная: withRetry(3) → фоллбэк без ретраев → throw наверх.
```

```ts
// src/scripts/chunking/lib/llm/concurrency.ts
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]>
// До LLM_CONCURRENCY задач разом (у :free-моделей жёсткий rate-limit).
```

```ts
// src/scripts/chunking/lib/llm/report.ts
export function writeLlmReport(report: LlmTypeReport): void
// data/llm-content/<type>.md: всего/заполнено/пропущено/failed + модели + failedIds.
```

Конфиг — только из env, без дублей:

```ts
// src/scripts/chunking/lib/llm/config.ts
export const LLM_MODEL = config.LLM_MODEL;                       // baidu/ernie-5.5-flash-preview:free
export const LLM_FALLBACK_MODEL = config.LLM_FALLBACK_MODEL;     // z-ai/glm-5.3-flash
export const LLM_CONCURRENCY = config.LLM_CONCURRENCY;           // 3
export const LLM_ATTEMPTS = 3;
export const VALIDATE_ATTEMPTS = 3;
export const LLM_MAX_TOKENS = 6500;                              // запас на reasoning
export const LLM_PROMPT_VERSION = "llm-content-v1";
export const REGEX_PROMPT_VERSION = "regex-markers-v1";
```

### 3.2 Per-type: `<type>/llm-validating/`

Одинаковая структура, разная логика ответа и валидации.

| Файл | Что принимает | Что отдаёт |
|---|---|---|
| `types.ts` | — | `LlmChunkRow {id,text}`, `*RunOptions {apply,force,probe?,limit?}`, `*RunResult`, `*Validation` |
| `config.ts` | `text`, `reference` | `ChatMessage[]` (system+user), whitelist значений, путь к справочнику |
| `validate.ts` | `answer: unknown` (+ словари для best) | `{ok:true,value}` \| `{ok:false,error}` — чистая функция |
| `store.ts` | `force` | `LlmChunkRow[]` только с `null`-полями; `update*` пишет одно поле + мета |
| `run.ts` | `*RunOptions` | `*RunResult` + отчёт; `fillOne` — до 3 повторов при невалидном ответе |

Валидация по типам:

```ts
// src/scripts/chunking/case/llm-validating/validate.ts
// fearClosed: массив, ⊂ {1..7}, без дублей → сортировка; пустой = []
export function validateCaseAnswer(answer: unknown): CaseValidation
```

```ts
// src/scripts/chunking/best/llm-validating/validate.ts
// sScheme ∈ S1..S15 | null; closingType ∈ {лестница,факторы,мостик,CTA,арка} | null;
// markers: 4 массива, значения — из словарей (проверка подстрокой + стемминг 5 символов,
// возраст «N лет» 30..80 и «в N» — отдельным чеком).
export function validateBestAnswer(answer: unknown, dicts: Record<keyof BestMarkers, string>): BestValidation
```

```ts
// src/scripts/chunking/audience/llm-validating/validate.ts
// fearType: целое 1..7 | null (null — валидный ответ «страх не выражен»)
export function validateAudienceAnswer(answer: unknown): AudienceValidation
```

Справочники передаются модели целиком: `fear_markers.md` (case/audience), `VOICE.md` + 4 словаря маркеров (best).

### 3.3 Диспетчер

```ts
// src/scripts/chunking/llm-validate.ts
// tsx ... <type> [--apply] [--force] [--probe N] [--limit N]
// type: case|best|audience|all. Без --apply — dry-run (БД не трогаем).
```

`--limit` добавлен, чтобы укладываться в 10-минутный лимит вызова и в rate-limit `:free`-модели.

### 3.4 Regex-маркеры (детерминированный путь)

```ts
// src/scripts/chunking/lib/markers/regex-markers.ts
export function buildMarkerRules(dicts: MarkerDicts): MarkerRule[]      // 355 правил из 4 словарей
export function detectMarkers(text: string, rules: MarkerRule[]): BestMarkers
export function isEmptyMarkers(markers: unknown): boolean
```

Парсер словарей: строки-буллеты, цитаты `«…»`, пропуск code-fence и блока «ИСКЛЮЧЕНЫ», снятие пояснений в скобках. Однословные правила матчатся по основе (−2 символа), чтобы ловить формы («супруга» → «супругу»); числовые шаблоны (`N лет`, `зарплата N тысяч`) — строго, с проверкой диапазона.

```ts
// src/scripts/chunking/markers-regex.ts
// npm run markers:regex -- best --apply [--force] [--limit N]
// getChunksMissingMarkers → detectMarkers → updateMarkers(model:"regex")
```

### 3.5 Схема и метаданные

В `Chunk` добавлены поля для воспроизводимости эпизодов:

```prisma
// prisma/schema.prisma
llmProcessedAt   DateTime?
llmModel         String?
llmPromptVersion String?
```

`run.ts` пишет их при каждом обновлении (точная модель + версия промпта). Для уже прогнанных чанков — `src/scripts/chunking/llm-backfill-meta.ts` (`llmModel = "mixed:…"`).

Не тронуто: `embed.ts`, `chunk.ts`, `load.ts`, эмбеддинги, остальная логика чанкеров.

## 4. UI

Не применимо — CLI-скрипты, без UI.

## 5. Поток данных

```
npm run llm:validate -- best --apply --limit 10
↓
llm-validate.ts: readType/readFlagValue → runBestLLM({apply,force,limit})
↓
store.getChunksMissing(force) → rows[{id,text}]  (только null-поля)
↓
mapLimit(rows, LLM_CONCURRENCY=3, fillOne)
↓
fillOne: buildBestMessages(text, VOICE.md, 4 словаря) → chatJSONWithFallback(messages,{maxTokens:6500})
↓   ├─ primary: chatJSON(LLM_MODEL) через withRetry(3, backoff 1500)
↓   └─ fallback: chatJSON(LLM_FALLBACK_MODEL) без ретраев
↓
validateBestAnswer(answer, dicts) → {ok,value} | {ok:false,errors}
↓   невалидно → тот же промпт, до VALIDATE_ATTEMPTS=3
↓
store.updateBestFields(id, {sScheme,closingType,markers}, {model,version})
↓   UPDATE "Chunk" SET sScheme, closingType, markers, llmProcessedAt, llmModel, llmPromptVersion
↓
writeLlmReport → data/llm-content/best.md
```

Regex-ветка:

```
npm run markers:regex -- best --apply
↓
loadDicts() → buildMarkerRules() → 355 правил
↓
getChunksMissingMarkers(force) → rows (markers null или 4 пустых массива)
↓
detectMarkers(text, rules) → {fear,bio,emotional,anti}
↓
updateMarkers(id, markers, {model:"regex", version:"regex-markers-v1"})
```

## 6. Почему так, а не иначе

1. **Общий только клиент.** Промпт, whitelist и валидация у типов разные — в одном «универсальном» раннере это превратилось бы в ветвление по типу. Поэтому `lib/llm/` — транспорт, `<type>/llm-validating/` — логика.
2. **Фоллбэк без ретраев.** `:free`-модель отдаёт 429/пустой ответ; повторять фоллбэк теми же 3 попытками — только жечь лимит. Основная — 3 попытки, фоллбэк — одна.
3. **Валидация до записи.** Модель возвращает мусор (вне 1..7, выдуманный маркер) — 3 повтора тем же промптом, затем `failed` в отчёт. Запись только после `ok`.
4. **Пустое = обработано.** `null` и `[]` — валидный финал («ничего нет»), поэтому повторно не спрашиваем; иначе 25 позиций перезапрашивались бы каждый прогон.
5. **Regex — второй источник для маркеров.** LLM стабильно возвращала 4 пустых массива на 16 постах; regex закрыл 12 из них детерминированно и без запросов.
6. **`--limit` и `--probe`.** `:free` режет rate-limit, а прогон должен быть предсказуемым; `--probe` даёт проверить промпт на N чанках без записи в БД.

## Преимущества

- ✅ dry-run по умолчанию: план печатается, БД не трогается
- ✅ фоллбэк на вторую модель при 429/пустом ответе основной
- ✅ валидация по словарям до записи, мусор не попадает в БД
- ✅ запись одного поля по `id` + метаданные версии, без JSON-дерева
- ✅ отчёт `data/llm-content/<type>.md`: заполнено/failed/модели
- ✅ regex-маркеры без запросов к модели
- ✅ переиспользованы `withRetry`, `env`, `prisma`, `readChunkTree` — нового транспорта нет