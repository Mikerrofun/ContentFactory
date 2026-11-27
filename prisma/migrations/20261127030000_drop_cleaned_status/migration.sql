-- Удаляем неиспользуемые поля Chunk.
-- cleaned: текст всегда очищается при чанкинге, флаг не нужен.
-- status: избыточен (depleted выводится из depletion=0), enum ChunkStatus удалён.
ALTER TABLE "Chunk" DROP COLUMN IF EXISTS "cleaned";
ALTER TABLE "Chunk" DROP COLUMN IF EXISTS "status";
DROP TYPE IF EXISTS "ChunkStatus";