-- AlterTable
ALTER TABLE "CartSession" ADD COLUMN "discountCodes" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Shop" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopifyDomain" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Los_Angeles',
    "retentionDays" INTEGER NOT NULL DEFAULT 90,
    "cartlinkEnabled" BOOLEAN NOT NULL DEFAULT false,
    "botFilterEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Shop" ("botFilterEnabled", "cartlinkEnabled", "createdAt", "id", "retentionDays", "shopifyDomain", "timezone", "updatedAt") SELECT "botFilterEnabled", "cartlinkEnabled", "createdAt", "id", "retentionDays", "shopifyDomain", "timezone", "updatedAt" FROM "Shop";
DROP TABLE "Shop";
ALTER TABLE "new_Shop" RENAME TO "Shop";
CREATE UNIQUE INDEX "Shop_shopifyDomain_key" ON "Shop"("shopifyDomain");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
