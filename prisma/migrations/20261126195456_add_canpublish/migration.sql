-- CreateEnum
CREATE TYPE "ChunkType" AS ENUM ('knowledge', 'case', 'fact', 'voice', 'swipe', 'audience');

-- CreateEnum
CREATE TYPE "ChunkStatus" AS ENUM ('active', 'depleted', 'archived');

-- CreateEnum
CREATE TYPE "CanPublish" AS ENUM ('yes', 'partial', 'no');

-- CreateEnum
CREATE TYPE "PostType" AS ENUM ('human', 'proof_case', 'method', 'trust', 'proof_path');

-- CreateEnum
CREATE TYPE "Verdict" AS ENUM ('pass', 'warn', 'fail');

-- CreateEnum
CREATE TYPE "RuleScope" AS ENUM ('global', 'type');

-- CreateEnum
CREATE TYPE "RuleStatus" AS ENUM ('active', 'veto', 'candidate', 'exception');

-- CreateTable
CREATE TABLE "Chunk" (
    "id" TEXT NOT NULL,
    "type" "ChunkType" NOT NULL,
    "text" TEXT NOT NULL,
    "sourcePath" TEXT,
    "sourceUrl" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "depletion" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bundleHits" INTEGER NOT NULL DEFAULT 0,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "status" "ChunkStatus" NOT NULL DEFAULT 'active',
    "topic" TEXT,
    "facts" JSONB,
    "factEmbeddings" JSONB,
    "factsUsed" JSONB,
    "cleaned" BOOLEAN NOT NULL DEFAULT false,
    "fearClosed" JSONB,
    "steps" JSONB,
    "result" TEXT,
    "incomeMilestone" TEXT,
    "cooldownUntil" TIMESTAMP(3),
    "heroBio" TEXT,
    "sourceProof" JSONB,
    "sScheme" TEXT,
    "pillar" TEXT,
    "markers" JSONB,
    "closingType" TEXT,
    "isHumanFinal" BOOLEAN NOT NULL DEFAULT false,
    "format" TEXT,
    "whyItWorks" JSONB,
    "structure" JSONB,
    "patternsToBorrow" JSONB,
    "doNotCopy" JSONB,
    "factText" TEXT,
    "allowedContext" TEXT,
    "forbidden" JSONB,
    "numberValue" TEXT,
    "period" TEXT,
    "canPublish" "CanPublish",
    "fearType" INTEGER,
    "phrase" TEXT,
    "emotion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Chunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL,
    "type" "PostType" NOT NULL,
    "topic" TEXT,
    "draft" TEXT NOT NULL,
    "final" TEXT,
    "verdict" "Verdict",
    "tactFlags" JSONB,
    "metrics" JSONB,
    "fixHint" TEXT,
    "promptVersion" TEXT,
    "styleVersion" TEXT,
    "model" TEXT,
    "chosen" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rule" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "scope" "RuleScope" NOT NULL,
    "type" "PostType",
    "support" INTEGER NOT NULL DEFAULT 0,
    "conflict" INTEGER NOT NULL DEFAULT 0,
    "weightDelta" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "RuleStatus" NOT NULL DEFAULT 'candidate',
    "sourceEpisodes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Weight" (
    "id" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "history" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Weight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Episode" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "type" "PostType" NOT NULL,
    "tactFlags" JSONB,
    "draft" TEXT NOT NULL,
    "final" TEXT,
    "diff" JSONB,
    "choiceRank" INTEGER,
    "metricsSnapshot" JSONB,
    "ruleVersions" JSONB,
    "weightVersions" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Episode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "telegramId" TEXT,
    "rawText" TEXT,
    "mediaFileId" TEXT,
    "detectedType" "ChunkType",
    "status" TEXT NOT NULL DEFAULT 'received',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Chunk_type_status_idx" ON "Chunk"("type", "status");

-- CreateIndex
CREATE INDEX "Chunk_pillar_idx" ON "Chunk"("pillar");

-- CreateIndex
CREATE INDEX "Post_type_createdAt_idx" ON "Post"("type", "createdAt");

-- CreateIndex
CREATE INDEX "Rule_scope_status_idx" ON "Rule"("scope", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Weight_metric_key" ON "Weight"("metric");

-- CreateIndex
CREATE INDEX "Episode_postId_idx" ON "Episode"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "Source_telegramId_key" ON "Source"("telegramId");

-- CreateIndex
CREATE INDEX "Source_status_idx" ON "Source"("status");

-- AddForeignKey
ALTER TABLE "Episode" ADD CONSTRAINT "Episode_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
