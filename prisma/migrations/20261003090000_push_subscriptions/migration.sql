-- Push notifications for the athlete app: each phone that said yes and what it wants to
-- hear about, so a note from the coach can reach it with the app closed. Server-side
-- only, never synced.

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "athleteId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "timeZone" TEXT,
    "notes" BOOLEAN NOT NULL DEFAULT true,
    "plan" BOOLEAN NOT NULL DEFAULT true,
    "reminder" BOOLEAN NOT NULL DEFAULT true,
    "meets" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_athleteId_idx" ON "PushSubscription"("athleteId");

-- CreateTable
CREATE TABLE "PlanNotice" (
    "athleteId" TEXT NOT NULL PRIMARY KEY,
    "coachId" TEXT NOT NULL,
    "changedAt" DATETIME,
    "sentAt" DATETIME
);

-- CreateIndex
CREATE INDEX "PlanNotice_coachId_idx" ON "PlanNotice"("coachId");
