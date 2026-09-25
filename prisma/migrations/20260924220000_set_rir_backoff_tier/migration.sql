-- AlterTable
ALTER TABLE "SetLog" ADD COLUMN "rir" REAL;

-- Rows named as a back-off get the BACKOFF tier and the target of the row above them.
UPDATE "ExerciseRow"
SET "tier" = 'BACKOFF',
    "target" = COALESCE(
      (SELECT "above"."target" FROM "ExerciseRow" AS "above"
       WHERE "above"."dayId" = "ExerciseRow"."dayId" AND "above"."order" < "ExerciseRow"."order"
       ORDER BY "above"."order" DESC LIMIT 1),
      "target")
WHERE lower(replace(replace("exercise", '-', ''), ' ', '')) LIKE '%backoff%';
