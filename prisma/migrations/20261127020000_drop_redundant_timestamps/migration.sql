-- Удаляем дублирующие/ненужные поля-таймстемпы.
-- addedAt дублировал createdAt; updatedAt нигде не используется
-- (изменения трекаются через version/history/эпизоды/lastUsedAt).
-- createdAt остаётся у всех чанков (DEFAULT CURRENT_TIMESTAMP) — он уже заполнен.

ALTER TABLE "Chunk"  DROP COLUMN IF EXISTS "addedAt";
ALTER TABLE "Chunk"  DROP COLUMN IF EXISTS "updatedAt";
ALTER TABLE "Post"   DROP COLUMN IF EXISTS "updatedAt";
ALTER TABLE "Rule"   DROP COLUMN IF EXISTS "updatedAt";
ALTER TABLE "Weight" DROP COLUMN IF EXISTS "updatedAt";