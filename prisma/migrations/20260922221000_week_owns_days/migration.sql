-- A week now owns its days, so weeks of a phase no longer have to match each other.
-- The grid tables are rebuilt rather than altered; their contents are restored from
-- prisma/old-shape.json by scripts/restore-new-shape.mjs straight after this runs.
PRAGMA foreign_keys=OFF;

DROP TABLE "WeekCell";
DROP TABLE "ProgressionRule";
DROP TABLE "ExerciseRow";
DROP TABLE "Day";

-- Block loses its week count: the Week rows are the count now.
CREATE TABLE "new_Block" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "athleteId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "phase" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "squat1RM" REAL,
    "bench1RM" REAL,
    "dead1RM" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Block_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "Athlete" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Block_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Block" ("id", "athleteId", "programId", "order", "phase", "startDate", "squat1RM", "bench1RM", "dead1RM", "createdAt")
SELECT "id", "athleteId", "programId", "order", "phase", "startDate", "squat1RM", "bench1RM", "dead1RM", "createdAt" FROM "Block";
DROP TABLE "Block";
ALTER TABLE "new_Block" RENAME TO "Block";

CREATE TABLE "Week" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "blockId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    CONSTRAINT "Week_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "Block" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Week_blockId_order_key" ON "Week"("blockId", "order");

CREATE TABLE "Day" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "weekId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "rest" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Day_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "Week" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Day_weekId_index_key" ON "Day"("weekId", "index");

CREATE TABLE "ExerciseRow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dayId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'ACCESSORY',
    "target" TEXT NOT NULL,
    "exercise" TEXT NOT NULL,
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
    "fromId" TEXT,
    CONSTRAINT "ExerciseRow_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "Day" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExerciseRow_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "ExerciseRow" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ExerciseRow_fromId_key" ON "ExerciseRow"("fromId");
CREATE UNIQUE INDEX "ExerciseRow_dayId_order_key" ON "ExerciseRow"("dayId", "order");

CREATE TABLE "ProgressionRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rowId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "field" TEXT NOT NULL,
    "op" TEXT NOT NULL DEFAULT 'ADD',
    "amount" REAL NOT NULL,
    "everyWeeks" INTEGER NOT NULL DEFAULT 1,
    "startWeek" INTEGER NOT NULL DEFAULT 2,
    "endWeek" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "ProgressionRule_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "ExerciseRow" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

PRAGMA foreign_keys=ON;
