-- Videos the athlete sends from the athlete app. Only where each file is lives here; the
-- file itself is in object storage.

-- CreateTable
CREATE TABLE "AthleteVideo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "athleteId" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "AthleteVideo_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "Athlete" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "AthleteVideo_storageKey_key" ON "AthleteVideo"("storageKey");

-- CreateIndex
CREATE INDEX "AthleteVideo_athleteId_day_idx" ON "AthleteVideo"("athleteId", "day");

-- CreateIndex
CREATE INDEX "AthleteVideo_rowId_idx" ON "AthleteVideo"("rowId");
