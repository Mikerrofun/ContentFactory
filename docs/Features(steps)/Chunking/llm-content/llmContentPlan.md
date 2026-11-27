# LLM Content Filling — план реализации (planDemands)

## Основные файлы для изучения

- `docs/Features(steps)/Chunking/llm-content/llmContent.md` — какие поля и зачем (v2).
- `src/scripts/chunking/embed.ts`, `lib/embed/openrouter.ts`, `lib/embed/store.ts` — образец «клиент OpenRouter + store + dry-run/--apply».
- `src/config/env.ts` — `LLM_MODEL`, `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`.
- `src/shared/lib/net/with-retry.ts` — общий ретрай (для основной модели).
- `src/scripts/chunking/lib/fs/`, `lib/types.ts`, `lib/clean/` — общий слой.
- `src/scripts/chunking/{case,best,audience}/` — per-type чанкеры (по образцу структуры).
- `prisma/schema.prisma` — поля `fearClosed`, `sScheme`, `closingType`, `markers`, `fearType`, `facts`, `topic`.
- Справочники (передаём модели целиком): `docs/Info_ForGeneration/Markers/fear_markers.md`, `docs/Facts:Case:Best/VOICE.md`, `docs/Info_ForGeneration/Markers/{biomarkers,emotional_markers,anti_markers}.md`.

## Цель

Заполнить LLM-поля чанков (сейчас `null`) строгим JSON от модели и записать в БД. Общее — только клиент OpenRouter с фоллбэком; всё остальное — per-type в подпапке `llm-validating/`.

## Модели и фоллбэк

- Основная: `ernie-5.5-flash-preview` (OpenRouter), `temperature=0`, `response_format=json_object`.
- Фоллбэк: `glm-5.3-flash` (OpenRouter).
- Паттерн: запрос к основной через `withRetry` (3 попытки) → если все упали, запрос к фоллбэку **без ретраев** → если и фоллбэк упал (напр. невалидный ключ) — ошибка наверх, чанк помечается в отчёте как failed.

## Общий клиент (единственное общее)

`src/scripts/chunking/lib/llm/`:
- `openrouter.ts` — `chatJSON(messages, opts)`: fetch на `${BASE_URL}/chat/completions`, `response_format=json_object`, парсинг JSON; ключ `OPENROUTER_API_KEY`.
- `with-fallback.ts` — `chatJSONWithFallback(messages)`: основная модель с `withRetry(3)` → фоллбэк без ретраев → throw.
- `config.ts` — `LLM_MODEL`, `LLM_FALLBACK_MODEL` (из `config/env`), `LLM_TEMPERATURE=0`.
- `types.ts` — типы сообщений/ответа.

## Структура per-type

Внутри каждого типа: `<type>/llm-validating/`:
- `types.ts` — типы ответа/полей (в файле типов, не в логике).
- `config.ts` — промпт + whitelist/наборы допустимых значений + имя справочника.
- `validate.ts` — валидация ответа модели (чистая функция).
- `store.ts` — чтение чанков с `null`-полями и запись полей в БД (prisma).
- `run.ts` — основные функции: build prompt → вызов модели → валидация → запись; dry-run/`--apply`.

Диспетчер: `src/scripts/chunking/llm-validate.ts <type>` (dry-run по умолчанию, `--apply` пишет; `--force` перезаписывает не только null).

## Схема ответа и валидация (по полям)

| Тип | Поле | JSON-ответ | Валидация |
|---|---|---|---|
| case | `fearClosed` | `{"fearClosed":[1,6]}` | массив, ⊂ {1..7}, без дублей; пустой = [] |
| best | `sScheme` | `{"sScheme":"S4"}` | ∈ S1..S15 или null |
| best | `closingType` | `{"closingType":"мостик"}` | ∈ {лестница,факторы,мостик,CTA,арка} или null |
| best | `markers` | `{"markers":{"fear":[],"bio":[],"emotional":[],"anti":[]}}` | 4 массива строк, значения из словарей |
| audience | `fearType` | `{"fearType":6}` | ∈ 1..7 или null; только если `emotion`∈{страх,скрытый страх} |
| knowledge | `facts` | `{"facts":["…"]}` | 3–7 строк (будущее) |
| knowledge | `topic` | `{"topic":"…"}` | строка (будущее) |

При невалидном ответе: повтор запроса до 3 раз (тем же промптом); если всё ещё невалидно/мусор — поле = `null`, чанк в лог/отчёт как failed.

## Задачи (флоу, без кода)

1. **Общий клиент** `lib/llm/` (openrouter + with-fallback + config + types). Ссылка на `config/env`, `with-retry`.
2. **Типы** — в `<type>/llm-validating/types.ts`.
3. **Конфиг per-type** — `config.ts`: системный/пользовательский промпт (RU), путь к справочнику (целиком), допустимые наборы.
4. **Валидатор per-type** — `validate.ts`: чистая функция `validate(answer) → {ok, value|error}`.
5. **Store per-type** — `store.ts`: `getChunksMissing(type, field)` (только null, либо все при `--force`), `updateFields(id, patch)` через prisma.
6. **Run per-type** — `run.ts`: для каждого чанка (параллельно до 5): `text` + справочник (целиком) → `chatJSONWithFallback` → `validate` (до 3 повторов) → `updateFields`. Dry-run — только подсчёт/лог, без БД.
7. **Диспетчер** `llm-validate.ts` — маппинг тип→run, dry-run/`--apply`/`--force`.
8. **Отчёт** — `data/llm-content/<type>.md`: заполнено/пропущено/failed. Сырые ответы — только в лог.
9. **Комментарии** — только на неочевидном (фоллбэк, валидация).

## Запись в БД

- Только нужное поле по `id` (upsert-патч), без JSON-дерева.
- Идемпотентно: по умолчанию только `null`-поля; `--force` — перезапись.
- Эмбеддинги не трогаем (уже заполнены).

## Тесты (минимальные, в конце)

- Юнит `validate.ts` (case/best/audience): валидный и невалидный ответ → ok/error.
- Смоук `llm-validate.ts <type>` (dry-run): печатает план, в БД не пишет.
- Фоллбэк: мок основной модели с ошибкой → проверка, что вызван фоллбэк.

## Ограничения

- `knowledge.*` — будущее (тип knowledge позже).
- При невалидном/сбое — поле `null` + запись в отчёт/лог.
- Модели/ключи — из `config/env`; при невалидном ключе фоллбэк тоже падает → чанк failed.