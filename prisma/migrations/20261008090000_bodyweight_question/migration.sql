-- Bodyweight becomes a check-in question like the others. Every athlete who was asked it
-- before keeps being asked, first in their check-in. The id is fixed per athlete, so the
-- desktop copy and the server's make the same row and sync sees one question, not two.
INSERT OR IGNORE INTO "CheckinQuestion" ("id", "athleteId", "order", "label", "cadence", "days", "kind", "config", "icon", "color", "archived", "createdAt")
SELECT 'bw-' || "id", "id", -1, 'Bodyweight', 'DAILY', '', 'NUMBER', '{"bodyweight":true}', 'weight', 'blue', false, CURRENT_TIMESTAMP
FROM "Athlete";
