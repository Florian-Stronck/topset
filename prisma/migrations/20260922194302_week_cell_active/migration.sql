-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_WeekCell" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rowId" TEXT NOT NULL,
    "week" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sets" INTEGER,
    "reps" INTEGER,
    "intensityType" TEXT NOT NULL DEFAULT 'RPE',
    "intensity" REAL,
    "intensityMax" REAL,
    "rampStep" REAL,
    "coachNotes" TEXT,
    "actualWeight" REAL,
    "performedRpe" REAL,
    "athleteNotes" TEXT,
    CONSTRAINT "WeekCell_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "ExerciseRow" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_WeekCell" ("actualWeight", "athleteNotes", "coachNotes", "id", "intensity", "intensityMax", "intensityType", "performedRpe", "rampStep", "reps", "rowId", "sets", "week") SELECT "actualWeight", "athleteNotes", "coachNotes", "id", "intensity", "intensityMax", "intensityType", "performedRpe", "rampStep", "reps", "rowId", "sets", "week" FROM "WeekCell";
DROP TABLE "WeekCell";
ALTER TABLE "new_WeekCell" RENAME TO "WeekCell";
CREATE UNIQUE INDEX "WeekCell_rowId_week_key" ON "WeekCell"("rowId", "week");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
