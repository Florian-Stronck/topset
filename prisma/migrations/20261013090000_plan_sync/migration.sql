-- Two computers on one account. The server logs every plan row a desktop app pushes, so
-- the coach's other computers can pull what changed since they last looked; each desktop
-- app remembers what it last sent (and how far into that log it has read), so a restart
-- no longer has to guess. PlanChange is server-side only; SyncSent and SyncMeta are
-- desktop-side only. Neither is synced.

-- CreateTable
CREATE TABLE "PlanChange" (
    "rev" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "coachId" TEXT NOT NULL,
    "table" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "sessionId" TEXT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "PlanChange_coachId_rev_idx" ON "PlanChange"("coachId", "rev");

-- CreateTable
CREATE TABLE "SyncSent" (
    "table" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "sig" TEXT NOT NULL,

    PRIMARY KEY ("table", "id")
);

-- CreateTable
CREATE TABLE "SyncMeta" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);
