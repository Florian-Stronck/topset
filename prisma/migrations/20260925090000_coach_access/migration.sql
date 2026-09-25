-- AlterTable
ALTER TABLE "Coach" ADD COLUMN "disabledAt" DATETIME;
ALTER TABLE "Coach" ADD COLUMN "resetCodeHash" TEXT;
ALTER TABLE "Coach" ADD COLUMN "resetExpiresAt" DATETIME;
