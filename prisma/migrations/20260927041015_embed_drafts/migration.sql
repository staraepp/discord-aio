-- CreateTable
CREATE TABLE "EmbedDraft" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "embedId" TEXT,
    "name" TEXT NOT NULL,
    "template" JSONB NOT NULL,
    "componentActions" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmbedDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmbedDraft_guildId_userId_updatedAt_idx" ON "EmbedDraft"("guildId", "userId", "updatedAt");

-- CreateIndex
CREATE INDEX "EmbedDraft_updatedAt_idx" ON "EmbedDraft"("updatedAt");
