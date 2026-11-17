-- A competition holds what is the same for every athlete the coach takes to a meet; each Meet
-- becomes one athlete's entry in one. Every existing meet gets its own competition, with the
-- meet's id, so desktop copies and the server, which migrate separately, end up with the same ids.

-- CreateTable
CREATE TABLE "Competition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "coachId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "federation" TEXT,
    "date" DATETIME NOT NULL,
    "venue" TEXT,
    "weighInDay" TEXT,
    "weighInTime" TEXT,
    "startTime" TEXT,
    "rackBrand" TEXT,
    "reminders" TEXT,
    "shared" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Competition_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "Coach" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Competition_coachId_idx" ON "Competition"("coachId");

-- One competition per existing meet
INSERT INTO "Competition" ("id", "coachId", "name", "federation", "date", "venue", "weighInDay", "weighInTime", "startTime", "rackBrand", "reminders", "shared", "createdAt")
SELECT m."id", a."coachId", m."name", m."federation", m."date", m."venue", m."weighInDay", m."weighInTime", m."startTime", m."rackBrand", m."reminders", m."shared", m."createdAt"
FROM "Meet" m JOIN "Athlete" a ON a."id" = m."athleteId" WHERE a."coachId" IN (SELECT "id" FROM "Coach");

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Meet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "athleteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "federation" TEXT,
    "weightClass" TEXT,
    "bodyweight" REAL,
    "date" DATETIME NOT NULL,
    "goal" REAL,
    "venue" TEXT,
    "weighInDay" TEXT,
    "weighInTime" TEXT,
    "startTime" TEXT,
    "session" TEXT,
    "rackBrand" TEXT,
    "shared" BOOLEAN NOT NULL DEFAULT true,
    "shareAttempts" BOOLEAN NOT NULL DEFAULT false,
    "reminders" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "competitionId" TEXT NOT NULL,
    CONSTRAINT "Meet_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "Athlete" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Meet_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Meet" ("id", "athleteId", "name", "federation", "weightClass", "bodyweight", "date", "goal", "venue", "weighInDay", "weighInTime", "startTime", "session", "rackBrand", "shared", "shareAttempts", "reminders", "createdAt", "competitionId")
SELECT "id", "athleteId", "name", "federation", "weightClass", "bodyweight", "date", "goal", "venue", "weighInDay", "weighInTime", "startTime", "session", "rackBrand", "shared", "shareAttempts", "reminders", "createdAt", "id" FROM "Meet";
DROP TABLE "Meet";
ALTER TABLE "new_Meet" RENAME TO "Meet";
CREATE INDEX "Meet_athleteId_idx" ON "Meet"("athleteId");
CREATE INDEX "Meet_competitionId_idx" ON "Meet"("competitionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
