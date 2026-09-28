-- AlterTable
ALTER TABLE "Athlete" ADD COLUMN "viewToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Athlete_viewToken_key" ON "Athlete"("viewToken");
