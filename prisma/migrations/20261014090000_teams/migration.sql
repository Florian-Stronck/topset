-- Multi-coach teams. A team's coaches share its athletes; each athlete still has one owner
-- (coachId). The plan log names the athlete of every row, so teammates pull each other's
-- edits. Team and TeamMember are written on the server only; desktop apps keep a copy.

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "teamId" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,

    PRIMARY KEY ("teamId", "coachId"),
    CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TeamMember_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "Coach" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TeamMember_coachId_idx" ON "TeamMember"("coachId");

-- AlterTable
ALTER TABLE "Athlete" ADD COLUMN "teamId" TEXT REFERENCES "Team" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "Athlete_teamId_idx" ON "Athlete"("teamId");

-- AlterTable
ALTER TABLE "PlanChange" ADD COLUMN "athleteId" TEXT;

-- CreateIndex
CREATE INDEX "PlanChange_athleteId_rev_idx" ON "PlanChange"("athleteId", "rev");
