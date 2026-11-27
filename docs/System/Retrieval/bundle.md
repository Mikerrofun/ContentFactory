# Сборка бандла (Retrieval, Этап 1)

Статус: черновик v1, на согласование. Связка: Этап 1 (бандл) → Этап 4 (промпт) → Этап 2 (валидация) → Этап 3 (обучение) → Этап 5 (учёт/износ).

Главное:
1. Бандл собирается **вокруг якоря** (case/knowledge). Якорь — это «запрос», отдельной строки-входа нет.
2. **Два тракта, не один.** Ядро (case/knowledge) идёт через воронку (vector → RRF → depletion → MMR → rerank). Специи (fact/best/swipe/audience) добираются **по метаданным** и **минуют rerank**.
3. Rerank — только по ядру, с degrade (упал → порядок RRF), toggle. Специи rerank не трогает (иначе fact/audience получают ~0).
4. Финал — 5 слотов + гард, бюджет 12k токенов, **слабые блоки отбрасываются целиком**.
5. FTS нет (нет строки-входа; rerank закрывает точность). В БД результат не пишем (минимальная версия).
6. Самообучение retrieval = только `depletion` + веса скоринга + факт-учёт. Правила стиля (Этап 3) поиск НЕ крутят.

---

## 0. Состояние данных (проверено по БД)

| Тип | Кол-во | Эмбеддинги | LLM-поля | depletion |
|---|---|---|---|---|
| case | 68 | 68/68 | `fearClosed` 68/68 | 1.0 (статичен, списания пока нет) |
| fact | 98 | 98/98 | — | 0 (семантика сломана, см. §9) |
| best | 64 | 64/64 | `sScheme` 60, `closingType` 64, `markers` 64 | 0 |
| swipe | 56 | 56/56 | — | 0 |
| audience | 338 | 338/338 | `fearType` 30 (только страхи) | 0 |
| knowledge | 0 | — | — | — |

Следствия:
- Ядро сейчас = только `case` (68). `knowledge` появится позже (автор добавит ~10 для проверок).
- Все 624 вектора (4096d, qwen3-embedding-8b) на месте — векторный поиск работает.
- `depletion` реально живой только у `case`; списание появится в Этапе 5.

---

## 1. Структура модуля (FSD)

```
src/features/retrieval/
  index.ts            # оркестратор: публичный API retrieveBundle()
  run.ts              # CLI: npm run retrieve (1 якорь → бандл, вывод в консоль)
  config/
    retrieval.config.ts   # K, gate, τ, λ, веса RRF, бюджет, topK rerank
    models.config.ts      # embedding-модель, rerank-модель, env-ключи
    roles.config.ts       # роли и их приоритет
  types/
    retrieval.types.ts    # BundleInput, BundleResult, ScoredChunk, ContextUnit, …
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
    assemble/         # 7. сборка контекста (бюджет)
```

Шаги не импортируют друг друга: порядок знает только `index.ts`, шаги знают входы/выходы. Каждый шаг — подпапка с функцией + `*.config.ts` + `*.types.ts`.

---

## 2. Контракт входа/выхода

```ts
interface BundleInput {
  anchorId: string;            // id якоря (case/knowledge)
}

interface BundleResult {
  context: string;             // готовый текст для промпта (только бандл)
  chunks: ContextChunk[];      // что попало: id, type, role, score
  counters: {                  // след воронки
    recall: number; rrf: number; depletion: number;
    mmr: number; rerankIn: number; rerankOut: number; context: number;
  };
  truncated: boolean;          // контекст обрезан по бюджету
  anchor: { id: string; profile: AnchorProfile };
}
```

В БД не пишем (минимальная версия). `chunks/counters` — для CLI/логов и будущего учёта (Этап 5).

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
base   = Σ 1/(k + rank)                      # k=60, по списку recall
score  = base · (1
        + w_type  · matchType(anchor, cand)   # класс/тип
        + w_pillar· matchPillar               # PROOF/METHOD/TRUST/HUMAN
        + w_scheme· matchScheme               # sScheme/closingType/format
        + w_fear  · matchFear                  # пересечение fearClosed
        + w_fresh · (1 − depletion)^α )        # свежесть
```

Стартовые веса (подобрать A/B): `w_type 0.20, w_pillar 0.15, w_scheme 0.15, w_fear 0.15, w_fresh 0.15`. Итог — 50 кандидатов.

«Многомерность» = сходство по embedding + по метаданным (тип/пиллар/схема/страх) + свежесть. Чистый косинус не единственный сигнал.

---

## 6. Шаг 3. Фильтр depletion

Вход: 50. Выход: выжившие.

- `depletion < τ` → отсев. **τ = 0.3** (ниже нет смысла брать).
- ⚠️ Блокер: семантика `depletion` сломана (default 0). Чиним до запуска (§9).

---

## 7. Шаг 4. MMR

Вход: выжившие. Выход: ~12.

Итеративно, по одному:
```
MMR = λ·relevance − (1−λ)·max_sim(к уже выбранным)
```
`λ = 0.7`. Даёт «контекст дополняет якорь, а не дублирует». Списывает износ ровнее.

---

## 8. Шаг 5. Rerank (только ядро, degrade, toggle)

Вход: ~12 ядерных. Выход: 8 (из 30 → 10 по конфигу; при малом списке — сколько есть).

- Модель `cohere/rerank-5-fast` (OpenRouter; проверить транспорт, иначе Cohere-ключ).
- Пара «текст якоря ↔ текст чанка» → `relevance_score` 0..1, сортировка, top.
- **Только ядро.** Специи минуют rerank.
- **Degrade:** rerank упал/выключен → берём порядок RRF, бандл не рушим.
- **Toggle** в конфиге (MVP можно держать выключенным — фильтров хватает; включить как дожим).

Почему не гнать специи: `fact` (гарды/цифры) и `audience` (сырая речь 1-2 строки) по смыслу к якорю ≈ 0 — rerank их бы выкинул. Они отбираются по метаданным.

---

## 9. Шаг 6. Эталоны (по метаданным, минуют rerank)

Вход: профиль якоря. Выход: набор специй.

| Слот | Сколько | Как отбираем |
|---|---|---|
| best (voice) | **3** | по сумме метрик: `pillar` + `sScheme`/`closingType` + `markers`/тон; топ-3 |
| swipe | **до 2** | `pillar` + `format` |
| fact | **~10** | набор number-guard под `allowedContext`/`forbidden` якоря |
| audience | **до 20** | `fearType`/`emotion` под главный страх темы (мелкие, можно много) |
| case_proof | **2-3** | из уже отобранных 8 доноров (пересечение `fearClosed`), НЕ сверху |

`case_proof` берём из 8, чтобы не превышать лимит ядра (иначе на пост уйдёт 11 кейсов и лимит 8 теряет смысл). В будущем так же 2-3 из knowledge после фильтров.

Матч эталонов — по `pillar/fear` (не косинус): best/swipe по pillar (+sScheme/format), case_proof по пересечению fearClosed, audience по fearType главного страха.

---

## 10. Шаг 7. Assemble (бюджет 12k, только бандл)

Вход: якорь + 8 доноров + специи. Выход: `BundleResult`.

- Токенизатор `js-tiktoken`, энкодер `gpt-4o`. Бюджет **12000 токенов — только на бандл** (системный промпт/правила/гард — отдельно).
- Порядок: по убыванию скора (якорь → доноры → специи).
- **Атомарность:** блок не режется; не влезает — **отбрасываем целиком** (не обрезаем), идём к следующему.
- Слабые/не влезшие — вон (твоё «отсечь слабые, не впихивать»).
- Флаг `truncated`.
- Роли регистрируются по приоритету (anchor > donor > case_proof > voice > swipe > fact > audience), дедуп по id.

Итог: `context = sections.join('\n\n')`, `chunks[]`, `counters`, `truncated`.

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
- knowledge (появится позже).

---

## 14. Открытые / калибровочные

1. Точные `w_*`, `α`, `K`, `0.55`, `τ`, `λ` — стартовые, подбор на ручной разметке 50-100 постов.
2. Транспорт rerank: OpenRouter vs Cohere-ключ для `cohere/rerank-5-fast`.
3. Depletion-бэкфилл (`default 1.0`) — блокер.
4. Формат хранения весов скоринга (конфиг vs `Weight`).
5. Порог «полных правок» и длина cooldown — Этап 5.