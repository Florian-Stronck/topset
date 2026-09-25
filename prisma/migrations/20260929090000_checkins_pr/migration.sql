-- Check-ins the coach writes per athlete replace the fixed readiness check-in. The four
-- readiness scores and the note become five questions on each athlete that had them, and
-- every answer on file moves across. Ids are built from the old ones, so every copy of the
-- database (the desktop's and the server's) migrates to the same rows and sync sees no
-- difference between them.

-- CreateTable
CREATE TABLE "CheckinQuestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "athleteId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "label" TEXT NOT NULL,
    "cadence" TEXT NOT NULL DEFAULT 'DAILY',
    "days" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL,
    "config" TEXT NOT NULL DEFAULT '{}',
    "icon" TEXT NOT NULL DEFAULT 'check',
    "color" TEXT NOT NULL DEFAULT 'blue',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CheckinQuestion_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "Athlete" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CheckinAnswer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "athleteId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "value" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "CheckinAnswer_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "Athlete" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CheckinQuestion_athleteId_idx" ON "CheckinQuestion"("athleteId");

-- CreateIndex
CREATE INDEX "CheckinAnswer_athleteId_day_idx" ON "CheckinAnswer"("athleteId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "CheckinAnswer_questionId_day_key" ON "CheckinAnswer"("questionId", "day");

-- The readiness questions, on every athlete that was asked them or answered them. One no
-- longer asked is kept archived, so its answers still have a label.
INSERT INTO "CheckinQuestion" ("id", "athleteId", "order", "label", "cadence", "days", "kind", "config", "icon", "color", "archived")
SELECT 'rq-' || q."key" || '-' || a."id", a."id", q."ord", q."label", 'DAILY', a."readinessDays", q."kind", q."config", q."icon", q."color",
       CASE WHEN a."readinessDays" = '' THEN 1 ELSE 0 END
FROM "Athlete" a
CROSS JOIN (
    SELECT 'sleep' AS "key", 0 AS "ord", 'Sleep' AS "label", 'SCALE' AS "kind", '{"min":1,"max":5,"low":"Poor","high":"Great"}' AS "config", 'bed' AS "icon", 'blue' AS "color"
    UNION ALL SELECT 'stress', 1, 'Stress', 'SCALE', '{"min":1,"max":5,"low":"Very stressed","high":"Relaxed"}', 'gauge', 'orange'
    UNION ALL SELECT 'soreness', 2, 'Soreness', 'SCALE', '{"min":1,"max":5,"low":"Very sore","high":"Fresh"}', 'bandage', 'red'
    UNION ALL SELECT 'energy', 3, 'Energy', 'SCALE', '{"min":1,"max":5,"low":"Flat","high":"Ready to go"}', 'zap', 'amber'
    UNION ALL SELECT 'note', 4, 'Anything your coach should know?', 'TEXT', '{}', 'note', 'purple'
) q
WHERE a."readinessDays" <> '' OR EXISTS (SELECT 1 FROM "ReadinessLog" r WHERE r."athleteId" = a."id");

INSERT INTO "CheckinAnswer" ("id", "athleteId", "questionId", "day", "value", "createdAt", "updatedAt")
SELECT 'ra-' || v."key" || '-' || v."id", v."athleteId", 'rq-' || v."key" || '-' || v."athleteId", v."day", v."value", v."createdAt", v."updatedAt"
FROM (
    SELECT 'sleep' AS "key", "id", "athleteId", "day", CAST("sleep" AS TEXT) AS "value", "createdAt", "updatedAt", "deletedAt" FROM "ReadinessLog" WHERE "sleep" IS NOT NULL
    UNION ALL SELECT 'stress', "id", "athleteId", "day", CAST("stress" AS TEXT), "createdAt", "updatedAt", "deletedAt" FROM "ReadinessLog" WHERE "stress" IS NOT NULL
    UNION ALL SELECT 'soreness', "id", "athleteId", "day", CAST("soreness" AS TEXT), "createdAt", "updatedAt", "deletedAt" FROM "ReadinessLog" WHERE "soreness" IS NOT NULL
    UNION ALL SELECT 'energy', "id", "athleteId", "day", CAST("energy" AS TEXT), "createdAt", "updatedAt", "deletedAt" FROM "ReadinessLog" WHERE "energy" IS NOT NULL
    UNION ALL SELECT 'note', "id", "athleteId", "day", "note", "createdAt", "updatedAt", "deletedAt" FROM "ReadinessLog" WHERE "note" IS NOT NULL AND "note" <> ''
) v
WHERE v."deletedAt" IS NULL;

-- DropTable
DROP INDEX "ReadinessLog_athleteId_day_key";
DROP TABLE "ReadinessLog";

-- AlterTable
ALTER TABLE "Athlete" DROP COLUMN "readinessDays";

-- AlterTable
ALTER TABLE "SetLog" ADD COLUMN "pr" BOOLEAN NOT NULL DEFAULT false;
