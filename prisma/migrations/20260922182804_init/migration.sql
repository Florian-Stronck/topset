-- CreateTable
CREATE TABLE "Coach" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Athlete" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "coachId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'KG',
    "squat1RM" REAL,
    "bench1RM" REAL,
    "dead1RM" REAL,
    CONSTRAINT "Athlete_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "Coach" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Program" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "athleteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Program_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "Athlete" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Meet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "athleteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "federation" TEXT,
    "weightClass" TEXT,
    "bodyweight" REAL,
    "date" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Meet_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "Athlete" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Attempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "meetId" TEXT NOT NULL,
    "lift" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "weight" REAL,
    "result" TEXT NOT NULL DEFAULT 'PENDING',
    CONSTRAINT "Attempt_meetId_fkey" FOREIGN KEY ("meetId") REFERENCES "Meet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Block" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "athleteId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "phase" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "weeks" INTEGER NOT NULL DEFAULT 4,
    "squat1RM" REAL,
    "bench1RM" REAL,
    "dead1RM" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Block_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "Athlete" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Block_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Day" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "blockId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "rest" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Day_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "Block" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExerciseRow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dayId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'ACCESSORY',
    "target" TEXT NOT NULL,
    "exercise" TEXT NOT NULL,
    CONSTRAINT "ExerciseRow_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "Day" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "WeekCell" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rowId" TEXT NOT NULL,
    "week" INTEGER NOT NULL,
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

-- CreateIndex
CREATE UNIQUE INDEX "Coach_email_key" ON "Coach"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Attempt_meetId_lift_number_key" ON "Attempt"("meetId", "lift", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Day_blockId_index_key" ON "Day"("blockId", "index");

-- CreateIndex
CREATE UNIQUE INDEX "ExerciseRow_dayId_order_key" ON "ExerciseRow"("dayId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "WeekCell_rowId_week_key" ON "WeekCell"("rowId", "week");
