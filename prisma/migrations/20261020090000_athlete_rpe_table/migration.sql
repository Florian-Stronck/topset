-- An athlete's own RPE chart, as JSON; null uses the coach's.
ALTER TABLE "Athlete" ADD COLUMN "rpeTable" TEXT;
