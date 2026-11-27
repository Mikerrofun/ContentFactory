-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Drop legacy field
ALTER TABLE "Chunk" DROP COLUMN IF EXISTS "factText";

-- Add vector + metadata (всем типам)
ALTER TABLE "Chunk"
  ADD COLUMN "chunkEmbedding" vector(4096),
  ADD COLUMN "embeddingHash" TEXT,
  ADD COLUMN "embeddingModel" TEXT,
  ADD COLUMN "embeddingDims" INTEGER;