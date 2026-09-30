-- Macro targets per phase: what the athlete eats to, per day, while the phase runs.
ALTER TABLE "Block" ADD COLUMN "kcalTarget" REAL;
ALTER TABLE "Block" ADD COLUMN "proteinTarget" REAL;
ALTER TABLE "Block" ADD COLUMN "carbsTarget" REAL;
ALTER TABLE "Block" ADD COLUMN "fatTarget" REAL;
