-- AlterTable
ALTER TABLE "Athlete" ADD COLUMN "readinessDays" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "ReadinessLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "athleteId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "sleep" INTEGER,
    "stress" INTEGER,
    "soreness" INTEGER,
    "energy" INTEGER,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "ReadinessLog_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "Athlete" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ReadinessLog_athleteId_day_key" ON "ReadinessLog"("athleteId", "day");
