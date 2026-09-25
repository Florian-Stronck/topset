-- AlterTable
ALTER TABLE "Athlete" ADD COLUMN "accessToken" TEXT;

-- CreateTable
CREATE TABLE "SetLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rowId" TEXT NOT NULL,
    "setIndex" INTEGER NOT NULL,
    "weight" REAL,
    "reps" INTEGER,
    "rpe" REAL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "loggedAt" DATETIME NOT NULL,
    CONSTRAINT "SetLog_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "ExerciseRow" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Athlete_accessToken_key" ON "Athlete"("accessToken");

-- CreateIndex
CREATE INDEX "SetLog_loggedAt_idx" ON "SetLog"("loggedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SetLog_rowId_setIndex_key" ON "SetLog"("rowId", "setIndex");
