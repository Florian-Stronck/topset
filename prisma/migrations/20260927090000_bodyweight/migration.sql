-- CreateTable
CREATE TABLE "BodyweightLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "athleteId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "weight" REAL NOT NULL,
    "note" TEXT,
    "source" TEXT NOT NULL DEFAULT 'athlete',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "BodyweightLog_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "Athlete" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "BodyweightLog_athleteId_day_idx" ON "BodyweightLog"("athleteId", "day");
