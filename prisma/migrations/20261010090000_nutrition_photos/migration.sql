-- Nutrition as its own log, like bodyweight, and photos sent with check-in answers.

-- CreateTable
CREATE TABLE "NutritionLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "athleteId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "kcal" REAL,
    "protein" REAL,
    "carbs" REAL,
    "fat" REAL,
    "source" TEXT NOT NULL DEFAULT 'athlete',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "NutritionLog_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "Athlete" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "NutritionLog_athleteId_day_idx" ON "NutritionLog"("athleteId", "day");

-- CreateTable
CREATE TABLE "CheckinPhoto" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "athleteId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "CheckinPhoto_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "Athlete" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CheckinPhoto_storageKey_key" ON "CheckinPhoto"("storageKey");

-- CreateIndex
CREATE INDEX "CheckinPhoto_athleteId_day_idx" ON "CheckinPhoto"("athleteId", "day");
