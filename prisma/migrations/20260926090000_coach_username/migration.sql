-- Coaches sign in with a username now: Topset never sends mail, so an email address was only
-- ever a name. An existing email becomes the part before its @, lowercased; where two
-- coaches would end up with the same one, the end of their id keeps them apart.
ALTER TABLE "Coach" RENAME COLUMN "email" TO "username";
DROP INDEX "Coach_email_key";

UPDATE "Coach"
SET "username" = lower(substr("username", 1, instr("username", '@') - 1))
WHERE instr("username", '@') > 1
  AND NOT EXISTS (
    SELECT 1 FROM "Coach" AS "other"
    WHERE "other"."id" <> "Coach"."id"
      AND lower(CASE WHEN instr("other"."username", '@') > 1
                     THEN substr("other"."username", 1, instr("other"."username", '@') - 1)
                     ELSE "other"."username" END)
        = lower(substr("Coach"."username", 1, instr("Coach"."username", '@') - 1))
  );

UPDATE "Coach"
SET "username" = lower(substr("username", 1, instr("username", '@') - 1)) || '-' || lower(substr("id", -4))
WHERE instr("username", '@') > 1;

CREATE UNIQUE INDEX "Coach_username_key" ON "Coach"("username");
