-- The athlete inbox becomes a chat: either side writes a message, and `sender` says who.
-- Every message so far was the coach's.

-- AlterTable
ALTER TABLE "CoachMessage" ADD COLUMN "sender" TEXT NOT NULL DEFAULT 'coach';
