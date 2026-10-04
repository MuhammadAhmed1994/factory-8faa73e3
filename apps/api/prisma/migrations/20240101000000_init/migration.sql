-- Initial migration for the Team Kudos Board API (hand-written).
--
-- Creates the four tables of the ERD — members, kudos, reactions and sessions —
-- plus their enums, foreign keys, the unique email index and the
-- (kudosId, memberId) unique constraint that enforces "exactly one reaction
-- per member per kudos" (C-4 / AC-15).
--
-- Deliberate omissions:
--   * No CHECK/CHARACTER_LENGTH constraint on kudos.message — message length
--     (1-280 chars, C-2) is a service-layer validation rule, not a DB rule.
--   * No stored reaction-count columns — counts are computed with GROUP BY at
--     read time (AC-12/AC-14/AC-16).

-- CreateEnum
-- Seeded role; lead emails are marked at seed time (ADR-2 / Q-2).
CREATE TYPE "MemberRole" AS ENUM ('MEMBER', 'LEAD');

-- CreateEnum
-- The curated reaction emoji set 👍 ❤️ 🎉 🙌 (ADR-4 / Q-3).
CREATE TYPE "ReactionEmoji" AS ENUM ('THUMBS_UP', 'HEART', 'TADA', 'RAISED_HANDS');

-- CreateTable
CREATE TABLE "members" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kudos" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "hiddenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kudos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reactions" (
    "id" TEXT NOT NULL,
    "kudosId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "emoji" "ReactionEmoji" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Email is the sign-in identifier (C-5); one account per email.
CREATE UNIQUE INDEX "members_email_key" ON "members"("email");

-- CreateIndex
-- Exactly one reaction per member per kudos (C-4 / AC-15 replace semantics).
CREATE UNIQUE INDEX "reactions_kudosId_memberId_key" ON "reactions"("kudosId", "memberId");

-- AddForeignKey
ALTER TABLE "kudos" ADD CONSTRAINT "kudos_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kudos" ADD CONSTRAINT "kudos_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_kudosId_fkey" FOREIGN KEY ("kudosId") REFERENCES "kudos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
