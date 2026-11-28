# Сборка бандла (Retrieval, Этап 1)

Статус: черновик v2, на согласование. Связка: Этап 1 (бандл) → Этап 4 (промпт) → Этап 2 (валидация) → Этап 3 (обучение) → Этап 5 (учёт/износ).

Главное:
1. Бандл собирается **вокруг якоря** (case/knowledge). Якорь — это «запрос», отдельной строки-входа нет.
2. **Два тракта, не один.** Ядро (case/knowledge) идёт через воронку (vector → RRF → depletion → MMR → rerank). Специи (fact/best/swipe/audience) добираются **по метаданным** и **минуют rerank**.
3. RRF — только по ядру, многомерный (embedding + тип + pillar + схема + страх + topic + свежесть). Специи в RRF НЕ идут намеренно (они не тематические доноры).
4. Rerank — только по ядру, с degrade (упал → порядок RRF), toggle. Специи rerank не трогает.
5. Финал — 5 слотов + гард, бюджет 15k токенов, **слабые блоки отбрасываются целиком**. Состав по типам фиксируется в `composition`.
6. FTS нет (нет строки-входа; rerank закрывает точность). В БД результат не пишем (минимальная версия).
7. Самообучение retrieval = только `depletion` + веса скоринга + факт-учёт. Правила стиля (Этап 3) поиск НЕ крутят.

---

## Требования к плану (planDemands)

1. **Основные файлы для изучения** — в начале (§0.1), чтобы агент понял проект и зону работ.
2. **Тесты** — в конце (§15), минимальные, не перегружать агента.
3. **Задачи — без кода.** Подробно описывать флоу и на что ссылаться (файлы/модули), а не приводить готовый код.
4. **Не просить документацию** — автор сделает её позже, после полного рефакторинга.
5. **FSD + типизация/конфиги отдельно.** Вся типизация — в файлах типов (`types.ts`), не вместе с логикой; конфиги/константы — в `config.ts`; не хардкодить в логике.
6. **Комментарии** — только на важных/первым взглядом непонятных местах, не в каждом углу.

---

## 0.1 Основные файлы для изучения (перед работой)

- `prisma/schema.prisma` — модель `Chunk` (type, text, topic, pillar, sScheme, closingType, format, fearClosed, markers, emotion, fearType, depletion, cooldownUntil, chunkEmbedding).
- `src/db/prisma.ts` — singleton Prisma (driver adapter).
- `src/shared/lib/net/with-retry.ts` — общий `withRetry` (переиспользуем).
- `src/config/env.ts` — env (LLM/EMBEDDING/OPENROUTER ключи).
- `src/scripts/chunking/lib/embed/*` — клиент эмбеддингов (openrouter) + store (образец чтения/записи вектора).
- `src/scripts/chunking/lib/llm/*` — клиент OpenRouter (openrouter.ts, config.ts) — образец для rerank-клиента.
- `docs/System/Chunks/chunks.md`, `chunkPresentation.md` — типы чанков, 5 слотов, износ.
- `docs/System/Retrieval/bundle.md` — этот документ.
- `docs/Facts:Case:Best/PILLARS.md` — pillar → формат (A-M).
- `docs/Info_ForGeneration/Markers/fear_markers.md` — 7 групп страхов (fearType/fearClosed).
- `data/chunks/<type>/*.json` — реальные примеры (особенно `fact`, `audience`, `swipe`).

---

## 0.2 Состояние данных (проверено по БД)

| Тип | Кол-во | Эмбеддинги | LLM-поля | depletion |
|---|---|---|---|---|
| case | 68 | 68/68 | `fearClosed` 68/68 | 1.0 (статичен, списания пока нет) |
| fact | 98 | 98/98 | — | 0 (семантика сломана, см. §14) |
| best | 64 | 64/64 | `sScheme` 60, `closingType` 64, `markers` 64 | 0 |
| swipe | 56 | 56/56 | — | 0 |
| audience | 338 | 338/338 | `fearType` 30 (только страхи) | 0 |
| knowledge | 0 | — | — | — |

Следствия:
- Ядро сейчас = только `case` (68). `knowledge` появится позже (автор добавит ~10 для проверок).
- Все 624 вектора (4096d, qwen3-embedding-8b) на месте — векторный поиск работает.
- `depletion` реально живой только у `case`; списание появится в Этапе 5.
- У `audience` `fearType` заполнен лишь у 30/338 → audience берём мало и без emotion-сходства.

---

## 1. Структура модуля (FSD)

```
src/features/retrieval/
  index.ts            # оркестратор: публичный API retrieveBundle()
  run.ts              # CLI: npm run retrieve (1 якорь → бандл, вывод в консоль)
  config/
    retrieval.config.ts   # K, gate, τ, λ, веса RRF, бюджет, topK rerank, лимиты специй
    models.config.ts      # embedding-модель, rerank-модель, env-ключи
    roles.config.ts       # роли и их приоритет
  types/
    retrieval.types.ts    # BundleInput, BundleResult, ScoredChunk, ContextUnit, Composition
  lib/
    retry.ts              # withRetry (переиспользуем shared/lib/net/with-retry)
    prisma.ts             # подключение (переиспользуем src/db/prisma)
    embed.ts              # эмбеддинг якоря (тот же клиент, что ингест)
    rerank.ts             # cohere/rerank-5-fast через OpenRouter
  steps/
    profile/          # 0. профиль якоря
    recall/           # 1. vector recall (ядро)
    fusion/           # 2. взвешенный RRF
    depletion/        # 3. фильтр выработки
    mmr/              # 4. MMR
    rerank/           # 5. rerank (только ядро, degrade)
    spices/           # 6. эталоны по метаданным (минуют rerank)
    assemble/         # 7. сборка контекста (бюджет) + composition
```

Шаги не импортируют друг друга: порядок знает только `index.ts`, шаги знают входы/выходы. Каждый шаг — подпапка с функцией + `*.config.ts` + `*.types.ts`.

---

## 2. Контракт входа/выхода

```ts
interface BundleInput { anchorId: string; }

interface BundleResult {
  context: string;             // готовый текст для промпта (только бандл)
  chunks: ContextChunk[];      // что попало: id, type, role, score
  composition: Composition;    // фактическое число чанков по типам
  counters: {                  // след воронки
    recall: number; rrf: number; depletion: number;
    mmr: number; rerankIn: number; rerankOut: number; context: number;
  };
  truncated: boolean;          // контекст обрезан по бюджету
  anchor: { id: string; profile: AnchorProfile };
}

type ChunkType = 'knowledge'|'case'|'fact'|'best'|'swipe'|'audience';
type Composition = Record<ChunkType | 'anchor', number>;
```

В БД не пишем (минимальная версия). `chunks/composition/counters` — для CLI/логов и будущего учёта (Этап 5).

### Роли (приоритет: меньше — главнее)

| Роль | Откуда | Смысл |
|---|---|---|
| `anchor` | якорь | тема, вокруг которой всё |
| `donor` | ядро после воронки | фактурные соседи (case/knowledge) |
| `case_proof` | из 8 доноров | доказательство под страх |
| `voice` | best | few-shot стиля |
| `swipe` | swipe | морф-шаблон |
| `fact` | fact | number-guard |
| `audience` | audience | язык/узнавание |

---

## 3. Шаг 0. Профиль якоря

Вход: `anchorId`. Выход: `AnchorProfile`.

Читаем из `Chunk`: `type`, `topic`, `pillar`, `sScheme`, `closingType`, `format`, `fearClosed[]`, `markers`, `emotion`, `depletion`. Это «запрос» для обоих трактов (заменяет строку-вход и шаг classification из старого retrieval).

Якорь выбирается **случайно из `case`** (MVP). Позже — **взвешенно-случайно по `(1−depletion)^α`**: чем ниже depletion, тем меньше шанс стать якорем. Сейчас у всех `depletion=1` → равномерно случайно.

---

## 4. Шаг 1. Vector recall (только ядро)

Вход: `anchorId`, профиль. Выход: `ScoredChunk[]` (топ-K).

- Эмбеддинг якоря тем же клиентом/моделью, что ингест (`qwen3-embedding-8b`, 4096d, `search_document`).
- Косинус к **только ядру** (`type IN (case, knowledge)`), `chunkEmbedding IS NOT NULL`.
- `score = 1 − (anchorEmbedding <=> candEmbedding::vector)`.
- Ворота: `score ≥ 0.55` (стартово, калибровать).
- `K ≈ 120` (на 68 case сейчас — все прошедшие ворота).

Специи (fact/best/swipe/audience) в recall **не пускаем** — они не фактические доноры темы.

---

## 5. Шаг 2. Взвешенный RRF (многомерное сходство)

Вход: список recall. Выход: топ-50.

RRF по рангам (k=60) **домножается на приоры из разных измерений** (не только embedding):

```
base  = Σ 1/(k + rank)                       # k=60, по списку recall
score = base · (1
        + w_type  · matchType(anchor, cand)  # класс/тип
        + w_pillar· matchPillar              # PROOF/METHOD/TRUST/HUMAN
        + w_scheme· matchScheme              # sScheme/closingType/format
        + w_fear  · matchFear                # пересечение fearClosed
        + w_topic · matchTopic )             # сходство topic (если есть)
        + w_fresh · (1 − depletion)^α        # свежесть
```

Стартовые веса (подобрать A/B, сумма ≈ 1): `w_type 0.20, w_pillar 0.15, w_scheme 0.15, w_fear 0.15, w_topic 0.10, w_fresh 0.15`. Итог — 50 кандидатов.

`matchTopic` считаем, только если у якоря и кандидата заполнен `topic` (case/knowledge); иначе 0. «Многомерность» = embedding + тип + pillar + схема + страх + topic + свежесть. Чистый косинус — не единственный сигнал.

---

## 6. Шаг 3. Фильтр depletion

Вход: 50. Выход: выжившие.

- `depletion < τ` → отсев. **τ = 0.3** (ниже нет смысла брать).
- ⚠️ Блокер: семантика `depletion` сломана (default 0). Чиним до запуска (§14).

---

## 7. Шаг 4. MMR

Вход: выжившие. Выход: ~12.

Итеративно, по одному: `MMR = λ·relevance − (1−λ)·max_sim(к уже выбранным)`, `λ = 0.7`. Даёт «контекст дополняет якорь, а не дублирует». Списывает износ ровнее.

---

## 8. Шаг 5. Rerank (только ядро, degrade, toggle)

Вход: ~12 ядерных. Выход: 8 (конфиг 30 → 10; при малом списке — сколько есть).

- Модель `cohere/rerank-5-fast` (OpenRouter; проверить транспорт, иначе Cohere-ключ).
- Пара «текст якоря ↔ текст чанка» → `relevance_score` 0..1, сортировка, top.
- **Только ядро.** Специи минуют rerank.
- **Degrade:** rerank упал/выключен → берём порядок RRF, бандл не рушим.
- **Toggle** в конфиге (MVP можно держать выключенным — фильтров хватает; включить как дожим).

Почему не гнать специи: `fact` (гарды/цифры) и `audience` (сырая речь 1-2 строки) по смыслу к якорю ≈ 0 — rerank их бы выкинул. Они отбираются по метаданным.

---

## 9. Шаг 6. Эталоны/специи (по метаданным, минуют rerank)

Специи не идут в RRF/rerank — у каждого типа **своя функция скора** против профиля якоря. Лимиты **мягкие (soft caps)**: `target` — ориентир, сверх можно добавлять, пока влезает в бюджет и качество ≥ `qualityThreshold`.

### 9.0 Насколько специи помогают агенту
- **best — ВЫСОКО:** few-shot стиля (голос/ритм). Без них — «робот».
- **fact — ВЫСОКО:** number-guard, защита от выдуманных цифр.
- **swipe — СРЕДНЕ:** каркас/механика (структуру и так держат 5 тактов + валидация).
- **audience — СРЕДНЕ/НИЗКО:** 2-3 фразы для узнавания; `fearType` у 30/338 → точность низкая.
Вывод: best/fact — не запирать (мягкие лимиты, бюджет-driven); audience — мало.

### 9.1 best (voice) — target 3, maxExtra +2
`score = 0.35·matchPillar + 0.25·matchScheme + 0.25·markerOverlap + 0.15·topicSim`. Топ-3; если 4-5 ≥ порога и есть бюджет — добавляем.

### 9.2 swipe — до 2, maxExtra +1
`score = 0.6·matchPillar + 0.4·matchFormat`. **Без cooldown и без depletion** (шаблон не «съедаем»; повтор структур ловят метрики 14-17).

### 9.3 fact — ~10 (number-guard)
Фильтр `canPublish ∈ {yes, partial}`; `score = matchPillar + topicMatch(allowedContext) − forbiddenPenalty`. Мягко ~10.

### 9.4 audience — до 15 (без emotion-сходства)
Только по `fearType == главный страх якоря` (где заполнен); иначе — маленький дефолтный набор. **emotion-сходство не используем** (мало заполнено, смысла нет).

### 9.5 case_proof — 2-3 из 8 доноров
`score = overlap(fearClosed, страх якоря)`. Из уже отобранных 8, НЕ сверху. В будущем так же 2-3 из knowledge после фильтров.

### 9.6 Мягкие лимиты и бюджет
Сначала обязательное (якорь + доноры + case_proof), затем специи по `target`; при остатке бюджета и качестве ≥ порога — добавляем до `maxExtra`. Кончился бюджет — стоп, лишнее вон, состав в `composition`.

### 9.7 Как рендерим специи в контекст (compact)
Специи в контекст идут **компактно, не целиком**. Эмбеддинг у всех по полному `text` (для матчинга), а в промпт — по правилу типа:

- **swipe:** вставляем `text` целиком + все поля (`whyItWorks`/`structure`/`patternsToBorrow`/`doNotCopy`). Полный текст = конкретный образец механики (few-shot учит лучше абстрактного скелета). `doNotCopy` — жёсткий гард «образец структуры, не копировать имена/кейсы/цифры/ссылки». Копирование ловит валидация (Этап 2).
- **best:** вставляем `text` целиком (золотой пост автора — few-shot стиля, копировать можно).
- **fact:** компактно `text` + `allowedContext`/`forbidden` (number-guard).
- **audience:** список фраз дословно (до 15).
- **donor / case_proof:** `text` (фактура).

Пример рендера swipe:
```
## Морф-шаблон (образец структуры; НЕ копировать дословно)
Структура: Хук → Контекст → 5–9 пунктов → Вывод → CTA
Приёмы: короткие абзацы; контраст «было/стало»; эмодзи-маркеры; одна цифра = один смысл
Не копировать: чужие имена/кейсы/цифры; фирменные фразы; ссылки конкурентов

Пример (чужой пост — только как образец механики):
<полный text swipe>
```

---

## 10. Шаг 7. Assemble (бюджет 15k, только бандл)

Вход: якорь + 8 доноров + специи. Выход: `BundleResult`.

- Токенизатор `js-tiktoken`, энкодер `gpt-4o`. Бюджет **15000 токенов — только на бандл** (системный промпт/правила/гард — отдельно).
- Порядок: по убыванию скора (якорь → доноры → специи).
- **Атомарность:** блок не режется; не влезает — **отбрасываем целиком** (не обрезаем), идём к следующему.
- Слабые/не влезшие — вон. Флаг `truncated`.
- Роли по приоритету (anchor > donor > case_proof > voice > swipe > fact > audience), дедуп по id.
- `composition` = фактические числа по типам после бюджета.

Итог: `context = sections.join('\n\n')`, `chunks[]`, `composition`, `counters`, `truncated`.

---

## 11. Отказоустойчивость

- Все сетевые/БД-вызовы — `withRetry` (3 попытки, backoff).
- Падение rerank — **не роняет** (degrade на RRF-порядок).
- Падение эмбеддинга/БД — роняет (без вектора recall невозможен).
- Отсутствующий env — ошибка с именем переменной.

---

## 12. Границы самообучения (важно)

Retrieval «учится» только через:
1. `depletion` → вес `(1−depletion)^α` (Этап 5 учёт).
2. Веса скоринга RRF (можно вынести в `Weight`, Этап 3).
3. Факт-учёт использованных чанков.

Правила стиля (Этап 3) **не влияют** на косинус/RRF — иначе стиль исказит тематический поиск.

---

## 13. Что НЕ в MVP

- FTS (нет строки-входа).
- Запись бандла в БД.
- 3-случайных стартовых экрана (старт: 1 якорь → 1 бандл).
- Джокеры (1-2 не по теме).
- Rerank как жёсткий гейт (только degrade/toggle).
- Swipe cooldown.
- knowledge (появится позже).

---

## 14. Открытые / калибровочные

1. Точные `w_*`, `α`, `K`, `0.55`, `τ`, `λ` — стартовые, подбор на ручной разметке 50-100 постов.
2. Транспорт rerank: OpenRouter vs Cohere-ключ для `cohere/rerank-5-fast`.
3. Depletion-бэкфилл (`default 1.0`) — блокер.
4. Формат хранения весов скоринга (конфиг vs `Weight`).
5. Порог «полных правок» и длина cooldown — Этап 5.

---

## 15. Тесты (минимальные, в конце)

- Юнит (чистые функции): `rrfScore`, `mmrSelect`, per-type `score*` (best/swipe/fact/audience) — валидный/невалидный вход.
- Смоук `run.ts <anchorId>`: печатает `context` + `composition` + `counters`, в БД не пишет.
- Degrade: мок rerank с ошибкой → проверка, что порядок = RRF и бандл не упал.
- Не перегружать: без интеграционных тестов на все 6 типов.