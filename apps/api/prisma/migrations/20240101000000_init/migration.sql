-- Initial schema for the Team Kudos Board API (T-2).
--
-- Hand-written to match `prisma/schema.prisma` exactly. It creates the four
-- tables, their foreign keys, the unique email index on "Member" and the
-- composite unique constraint on ("kudosId", "memberId") that enforces at most
-- one reaction per member per kudos (C-4 / AC-15).
--
-- Note: no length constraint is placed on "Kudos"."message" - the 1-280 char
-- rule (C-2) is a service-layer validation - and no reaction counts are stored.

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('MEMBER', 'LEAD');

-- CreateEnum
CREATE TYPE "ReactionEmoji" AS ENUM ('THUMBS_UP', 'HEART', 'TADA', 'RAISED_HANDS');

-- CreateTable
CREATE TABLE "Member" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Kudos" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "hiddenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Kudos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reaction" (
    "id" TEXT NOT NULL,
    "kudosId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "emoji" "ReactionEmoji" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Member_email_key" ON "Member"("email");

-- CreateIndex
CREATE INDEX "Member_role_idx" ON "Member"("role");

-- CreateIndex
CREATE INDEX "Kudos_createdAt_id_idx" ON "Kudos"("createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "Kudos_authorId_idx" ON "Kudos"("authorId");

-- CreateIndex
CREATE INDEX "Kudos_recipientId_idx" ON "Kudos"("recipientId");

-- CreateIndex
CREATE UNIQUE INDEX "Reaction_kudosId_memberId_key" ON "Reaction"("kudosId", "memberId");

-- CreateIndex
CREATE INDEX "Reaction_kudosId_idx" ON "Reaction"("kudosId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- AddForeignKey
ALTER TABLE "Kudos" ADD CONSTRAINT "Kudos_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Kudos" ADD CONSTRAINT "Kudos_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reaction" ADD CONSTRAINT "Reaction_kudosId_fkey" FOREIGN KEY ("kudosId") REFERENCES "Kudos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reaction" ADD CONSTRAINT "Reaction_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
