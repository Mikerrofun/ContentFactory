# Как считаются метрики (validationRecon)

Статус: черновик v2. Для каждого сгенерированного поста. 17 метрик: 13 качества + 4 разнообразия.

Обозначения: `post` — сгенерированный текст; `bundle` — собранный контекст; `history` — прошлые взятые посты; `gold` — золотые эталоны.

Файлы-источники (реальные пути):
- Маркеры: `docs/Info_ForGeneration/Markers/{biomarkers,emotional_markers,fear_markers,anti_markers}.md`
- Факты: `docs/Info_ForGeneration/PRODUCT_FACTS.md` + `Архив/FACTS.docx` (71 карточка)
- Стиль/правила: `docs/Info_ForGeneration/{VOICE_FINGERPRINT,LESSONS,STYLE_TRANSLATION,CONTENT_LEVELS}.md`
- Эталоны/структуры: `Архив/{BEST,VOICE,PILLARS,SWIPES,CASE,AUDIENCE,STANDARD,GUARDRAILS}.docx`
- Чанки: `docs/chunks.md` (поля `facts[]`, `s_scheme`, `format`, `chunk_embedding`, `fear_closed`)

---

## КАЧЕСТВО (1-13)

### 1. auto_score
Из чего: `Markers/anti_markers.md` (жаргон), `LESSONS.md` L4 (AI-маркеры), `STYLE_TRANSLATION.md` (стилевые замены), длина/формат (`STANDARD.docx`), непроверенные числа.
Как: детерминированные чекеры (regex/словарь) → сумма → 0..1. Без LLM.

### 2. human_factor
Из чего: `Markers/biomarkers.md` + `Markers/emotional_markers.md`.
Как: regex по словарям (группы синонимов) → `1−exp(−count/5)`. Локально.

### 3. adaptability
Из чего: `Markers/fear_markers.md` (7 групп) − `Markers/anti_markers.md`.
Как: (закрытые страхи/3) − штраф жаргон − штраф «высокий доход без био». Локально.

### 4. number-guard violation
Из чего: `PRODUCT_FACTS.md` + `Архив/FACTS.docx`.
Как: извлекаем числа из post → сверяем с базой; нет в базе и не гипотеза (GUARDRAILS) → violation. Локально.

### 5. style-близость
Из чего: `Архив/BEST.docx` (67 золотых) + финалы копирайтера.
Как: эмбеддинг post vs эталоны → макс косинус. Дёшево.

### 6. 5-тактная полнота
Из чего: структура post (см. `docs/System/Validation/validation.md`).
Как: 5 тактов присутствуют и не пустые. Детерминированно.

### 7. Fact-Recall
Из чего: `bundle.facts[]` (knowledge-доноры, `docs/chunks.md`).
Как: для каждого факта макс косинус с предложениями post → доля выше порога. Эмбеддинги есть.

### 8. Contradiction Rate
Из чего: `PRODUCT_FACTS.md` + `FACTS.docx` + case-карточки (`CASE.docx`).
Как: LLM-сверка (нет чужого опыта/выдуманных должностей) + number-guard. Частично LLM.

### 9. Cross-Post Repetition
Из чего: `history` (прошлые взятые посты).
Как: косинус post vs история + пересечение историй. После человека (Этап 5).

### 10. Edit Distance / Levenshtein
Из чего: `draft` vs `final` (после копирайтера).
Как: расстояние Левенштейна / длина. После человека.

### 11. Syntactic Rhythm
Из чего: `Архив/BEST.docx` (ритм автора).
Как: длина предложений/абзацев, пунктуация → коридор (не точка). Warn вне коридора.

### 12. Signature Vocabulary
Из чего: `Архив/BEST.docx` + `VOICE.docx` (TF-IDF).
Как: наличие оборотов → плюс; отсутствие НЕ штраф. Порог 1-2.

### 13. Entity Density
Из чего: post.
Как: имена/бренды/термины/события на 1000 знаков (NER + словарь). Локально.

---

## РАЗНООБРАЗИЕ (14-17)

### 14. Structure Repetition
Из чего: `s_scheme`/`format` (voice/swipe, `docs/chunks.md`) + `history`.
Как: тот же скелет N постов подряд → штраф. По метаданным.

### 15. Theme Repetition
Из чего: якорь/`chunk_embedding` + `history`.
Как: косинус якоря vs прошлые взятые → штраф.

### 16. Phrase Overlap (n-gram)
Из чего: `text` post + `history`.
Как: 3-5-граммы, пересечение с историей → доля. Локально.

### 17. Hook Similarity
Из чего: такт 1 post + `history`.
Как: косинус/сходство зачинов → штраф.

---

## Что когда считается
- **До человека (5 генераций):** 1-8, 11-17.
- **После человека:** 9, 10.
- **Без LLM:** 1,2,3,4,6,7,11,12,13,14,15,16,17.
- **LLM (лёгкая, OpenRouter):** 5 (частично), 8.

## Пороги
Стартовые фикс, калибровка на gold + по эпизодам. 67 золотых мало → пороги 14-17 предварительные.