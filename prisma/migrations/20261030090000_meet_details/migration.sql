-- A meet's goal total, where and when it is, the rack brand it lifts on, what the athlete
-- app shows of it, and the reminders the coach changed. Rack heights live on the athlete,
-- one set per brand, so the next meet on the same racks starts from them.
ALTER TABLE "Athlete" ADD COLUMN "racks" TEXT;
ALTER TABLE "Meet" ADD COLUMN "goal" REAL;
ALTER TABLE "Meet" ADD COLUMN "venue" TEXT;
ALTER TABLE "Meet" ADD COLUMN "weighInDay" TEXT;
ALTER TABLE "Meet" ADD COLUMN "weighInTime" TEXT;
ALTER TABLE "Meet" ADD COLUMN "startTime" TEXT;
ALTER TABLE "Meet" ADD COLUMN "session" TEXT;
ALTER TABLE "Meet" ADD COLUMN "rackBrand" TEXT;
ALTER TABLE "Meet" ADD COLUMN "shared" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Meet" ADD COLUMN "shareAttempts" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Meet" ADD COLUMN "reminders" TEXT;

-- The checklist: one row per thing to sort, so the athlete can tick theirs on the phone.
CREATE TABLE "MeetTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "athleteId" TEXT NOT NULL,
    "meetId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "doneBy" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "MeetTask_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "Athlete" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "MeetTask_meetId_idx" ON "MeetTask"("meetId");
CREATE INDEX "MeetTask_athleteId_idx" ON "MeetTask"("athleteId");
