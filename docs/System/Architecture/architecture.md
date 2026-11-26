# Архитектура / стек / индексация (Этап 6)

Статус: черновик v1. Привязка к реальному репо (Next.js 16 + Prisma 7 + Neon + pgvector + grammY + AI SDK + OpenRouter).

Главное:
1. Стек зафиксирован (есть в репо).
2. FSD: 6 фич по этапам.
3. Индексация: бот → Source → cron → определить тип → свой чанкер → эмбеддинг → active.
4. LLM/эмбеддинги: всё OpenRouter; эмбеддинг — быстрая модель (не OpenAI, уточнить).
5. Админка — позже (минимальная).
6. MVP = срез Этапы 1-2.

---

## 1. Стек (из репо)
- Next.js 16 (app router), React 19.
- Prisma 7 + Neon Postgres + pgvector.
- grammY (Telegram-бот).
- AI SDK + OpenRouter (всё: ген/критик/индексация).
- Zod (env/схемы).
- tsx (скрипты: `npm run bot`, `npm run cron:index`).

## 2. FSD-слои (6 фич)
`src/features/<feature>/{ui,model,lib,index.ts}`:
1. `chunking` — нарезка/индексация (по типу свой чанкер).
2. `generation` — сборка промпта + 5 генераций (Этап 4).
3. `validation` — 5 тактов + 17 метрик (Этап 2).
4. `learning` — 3 слоя правила/веса/эпизоды (Этап 3).
5. `accounting` — 3 поста/день + учёт (Этап 5).
6. `bot` — приём голос/файлов → Source.

Сущности: `src/entities/{chunk,post,rule,episode,source}`.
Сервисы/репозитории: `src/services`, `src/repositories`.
Промпты: `src/prompts`. Схемы: `src/schemas`.

## 3. Индексация (бот → БД)
1. Бот принимает голос/файл → `Source` (status=received).
2. `cron:index` берёт received → **определяет тип** (knowledge/case/fact/voice/swipe/audience).
3. По типу — **свой чанкер** (разные поля): `src/scripts/chunking/<type>.ts`.
4. Парс → очистка → маппинг полей (type-specific) → JSON.
5. Эмбеддинг (OpenRouter, быстрая модель) → `chunkEmbedding` (pgvector).
6. Запись в БД → status=active.
7. Ретраи/статус — воркер.

## 4. Провайдеры
- Всё OpenRouter: генерация (сильная), критик (лёгкая), индексация/эмбеддинги.
- Эмбеддинг: быстрая модель (не OpenAI; уточнить конкретную).
- `config/env.ts`: `OPENROUTER_API_KEY`, `LLM_MODEL`, `EMBEDDING_MODEL`.

## 5. Веб-админка
- Позже. Минимальная (просмотр/правки) — опишем, когда система готова.

## 6. MVP (первый показ) = срез Этапы 1-2
- Чанки (fact/voice/case) + индексация.
- 5-тактная валидация + 17 метрик.
- Генерация 1 поста (без полного обучения/учёта).
- Локальный прогон на созвоне → деплой на площадку.

## 7. Связка с моделью данных (Prisma)
- `Chunk` (6 типов, depletion, type-specific JSONB) — Этап 1.
- `Post` (type, draft/final, verdict, tactFlags, metrics) — Этап 2/5.
- `Rule`/`Weight`/`Episode` — Этап 3.
- `Source` — бот/индексация.
- `depletion @default(1.0)` (семантика 1=полный→0=исчерпан) — правка prisma.

## 8. Открытые вопросы
1. Конкретная быстрая модель эмбеддингов (не OpenAI).
2. Длина cooldown фактов/остальных.
3. Пороги 14-17.
4. Деплой/площадка (SSH из брифа).
5. Формат хранения type-specific (JSONB — уже есть).