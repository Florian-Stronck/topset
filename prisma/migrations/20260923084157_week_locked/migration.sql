-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Week" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "blockId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Week_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "Block" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Week" ("blockId", "id", "order") SELECT "blockId", "id", "order" FROM "Week";
DROP TABLE "Week";
ALTER TABLE "new_Week" RENAME TO "Week";
CREATE UNIQUE INDEX "Week_blockId_order_key" ON "Week"("blockId", "order");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
