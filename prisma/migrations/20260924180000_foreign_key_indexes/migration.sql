-- CreateIndex
CREATE INDEX "Athlete_coachId_idx" ON "Athlete"("coachId");

-- CreateIndex
CREATE INDEX "Block_athleteId_idx" ON "Block"("athleteId");

-- CreateIndex
CREATE INDEX "Block_programId_idx" ON "Block"("programId");

-- CreateIndex
CREATE INDEX "CoachSession_coachId_idx" ON "CoachSession"("coachId");

-- CreateIndex
CREATE INDEX "Meet_athleteId_idx" ON "Meet"("athleteId");

-- CreateIndex
CREATE INDEX "Program_athleteId_idx" ON "Program"("athleteId");

-- CreateIndex
CREATE INDEX "ProgressionRule_rowId_idx" ON "ProgressionRule"("rowId");
