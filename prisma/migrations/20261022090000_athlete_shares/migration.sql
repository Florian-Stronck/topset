-- Teams give way to sharing one athlete at a time, by code, as view, review or edit.
-- Every teammate who could see a team athlete keeps editing it, as an edit share.

-- CreateTable
CREATE TABLE "AthleteShare" (
    "athleteId" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("athleteId", "coachId"),
    CONSTRAINT "AthleteShare_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "Athlete" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AthleteShare_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "Coach" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AthleteShare_coachId_idx" ON "AthleteShare"("coachId");

-- CreateTable
CREATE TABLE "ShareCode" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "athleteId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "reusable" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShareCode_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "Athlete" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ShareCode_athleteId_idx" ON "ShareCode"("athleteId");

-- Teams become edit shares
INSERT OR IGNORE INTO "AthleteShare" ("athleteId", "coachId", "role")
SELECT a."id", m."coachId", 'edit' FROM "Athlete" a JOIN "TeamMember" m ON m."teamId" = a."teamId" WHERE m."coachId" != a."coachId";

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Athlete" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "coachId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'KG',
    "squat1RM" REAL,
    "bench1RM" REAL,
    "dead1RM" REAL,
    "variationPct" REAL,
    "variationPcts" TEXT,
    "rpeTable" TEXT,
    "sex" TEXT,
    "notes" TEXT,
    "activeProgramId" TEXT,
    "accessToken" TEXT,
    "viewToken" TEXT,
    CONSTRAINT "Athlete_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "Coach" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Athlete" ("accessToken", "activeProgramId", "bench1RM", "coachId", "dead1RM", "id", "name", "notes", "rpeTable", "sex", "squat1RM", "unit", "variationPct", "variationPcts", "viewToken") SELECT "accessToken", "activeProgramId", "bench1RM", "coachId", "dead1RM", "id", "name", "notes", "rpeTable", "sex", "squat1RM", "unit", "variationPct", "variationPcts", "viewToken" FROM "Athlete";
DROP TABLE "Athlete";
ALTER TABLE "new_Athlete" RENAME TO "Athlete";
CREATE UNIQUE INDEX "Athlete_accessToken_key" ON "Athlete"("accessToken");
CREATE UNIQUE INDEX "Athlete_viewToken_key" ON "Athlete"("viewToken");
CREATE INDEX "Athlete_coachId_idx" ON "Athlete"("coachId");
DROP TABLE "TeamMember";
DROP TABLE "Team";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
