-- AlterTable
ALTER TABLE "ExerciseRow" ADD COLUMN "duration" INTEGER;
ALTER TABLE "ExerciseRow" ADD COLUMN "session" TEXT;

-- AlterTable
ALTER TABLE "SetLog" ADD COLUMN "seconds" INTEGER;

-- AlterTable
ALTER TABLE "Meet" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'MEET';
ALTER TABLE "Meet" ADD COLUMN "opponent" TEXT;
ALTER TABLE "Meet" ADD COLUMN "weighIn" DATETIME;
ALTER TABLE "Meet" ADD COLUMN "targetWeight" REAL;
ALTER TABLE "Meet" ADD COLUMN "outcome" TEXT;

-- CreateTable
CREATE TABLE "Injury" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "athleteId" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "side" TEXT,
    "day" TEXT NOT NULL,
    "endDay" TEXT,
    "severity" INTEGER NOT NULL DEFAULT 2,
    "note" TEXT,
    "source" TEXT NOT NULL DEFAULT 'athlete',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "Injury_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "Athlete" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Injury_athleteId_day_idx" ON "Injury"("athleteId", "day");
