-- Combat sports are gone except timed sets (ExerciseRow.duration, SetLog.seconds) and injuries.

-- AlterTable
ALTER TABLE "Athlete" DROP COLUMN "sport";
ALTER TABLE "ExerciseRow" DROP COLUMN "session";
ALTER TABLE "Meet" DROP COLUMN "kind";
ALTER TABLE "Meet" DROP COLUMN "opponent";
ALTER TABLE "Meet" DROP COLUMN "weighIn";
ALTER TABLE "Meet" DROP COLUMN "targetWeight";
ALTER TABLE "Meet" DROP COLUMN "outcome";
