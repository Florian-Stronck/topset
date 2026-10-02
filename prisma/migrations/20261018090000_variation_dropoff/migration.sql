-- How far below the competition max an athlete trains their variations.
ALTER TABLE "Athlete" ADD COLUMN "variationPct" REAL;
ALTER TABLE "Athlete" ADD COLUMN "variationPcts" TEXT;
-- The coach's own notes on the athlete.
ALTER TABLE "Athlete" ADD COLUMN "notes" TEXT;
