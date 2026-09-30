-- Rescheduling and meetings: sessions the athlete moved to another date, and meetings
-- between coach and athlete that either side proposes.

-- CreateTable
CREATE TABLE "SessionMove" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "athleteId" TEXT NOT NULL,
    "dayId" TEXT NOT NULL,
    "fromDay" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "reason" TEXT,
    "seenAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "SessionMove_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "Athlete" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "athleteId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "time" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL DEFAULT 30,
    "timeZone" TEXT,
    "place" TEXT,
    "note" TEXT,
    "proposedBy" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "Meeting_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "Athlete" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "SessionMove_athleteId_day_idx" ON "SessionMove"("athleteId", "day");

-- CreateIndex
CREATE INDEX "Meeting_athleteId_day_idx" ON "Meeting"("athleteId", "day");
