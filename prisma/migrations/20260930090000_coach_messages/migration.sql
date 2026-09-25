-- Session review in Tracking: when the coach last looked at a session, and the notes they
-- send the athlete about it, read in the athlete app's inbox.

-- AlterTable
ALTER TABLE "Day" ADD COLUMN "reviewedAt" DATETIME;

-- CreateTable
CREATE TABLE "CoachMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "athleteId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "dayId" TEXT,
    "rowId" TEXT,
    "body" TEXT NOT NULL,
    "readAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "CoachMessage_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "Athlete" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CoachMessage_athleteId_day_idx" ON "CoachMessage"("athleteId", "day");
