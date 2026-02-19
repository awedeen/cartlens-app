-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CartSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "customerId" TEXT,
    "customerEmail" TEXT,
    "customerName" TEXT,
    "referrerUrl" TEXT,
    "landingPage" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "ipAddress" TEXT,
    "city" TEXT,
    "country" TEXT,
    "countryCode" TEXT,
    "deviceType" TEXT,
    "browser" TEXT,
    "os" TEXT,
    "userAgent" TEXT,
    "cartCreated" BOOLEAN NOT NULL DEFAULT false,
    "checkoutStarted" BOOLEAN NOT NULL DEFAULT false,
    "orderPlaced" BOOLEAN NOT NULL DEFAULT false,
    "orderId" TEXT,
    "orderValue" REAL,
    "discountCodes" TEXT,
    "cartTotal" REAL NOT NULL DEFAULT 0,
    "totalDiscounts" REAL NOT NULL DEFAULT 0,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "isSuspectedBot" BOOLEAN NOT NULL DEFAULT false,
    "botReason" TEXT,
    "merchantOverride" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CartSession_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CartSession" ("botReason", "browser", "cartCreated", "cartTotal", "checkoutStarted", "city", "country", "countryCode", "createdAt", "customerEmail", "customerId", "customerName", "deviceType", "discountCodes", "id", "ipAddress", "isSuspectedBot", "itemCount", "landingPage", "merchantOverride", "orderId", "orderPlaced", "orderValue", "os", "referrerUrl", "shopId", "updatedAt", "userAgent", "utmCampaign", "utmMedium", "utmSource", "visitorId") SELECT "botReason", "browser", "cartCreated", "cartTotal", "checkoutStarted", "city", "country", "countryCode", "createdAt", "customerEmail", "customerId", "customerName", "deviceType", "discountCodes", "id", "ipAddress", "isSuspectedBot", "itemCount", "landingPage", "merchantOverride", "orderId", "orderPlaced", "orderValue", "os", "referrerUrl", "shopId", "updatedAt", "userAgent", "utmCampaign", "utmMedium", "utmSource", "visitorId" FROM "CartSession";
DROP TABLE "CartSession";
ALTER TABLE "new_CartSession" RENAME TO "CartSession";
CREATE INDEX "CartSession_shopId_idx" ON "CartSession"("shopId");
CREATE INDEX "CartSession_shopId_createdAt_idx" ON "CartSession"("shopId", "createdAt");
CREATE INDEX "CartSession_visitorId_idx" ON "CartSession"("visitorId");
CREATE UNIQUE INDEX "CartSession_shopId_visitorId_key" ON "CartSession"("shopId", "visitorId");
CREATE TABLE "new_Shop" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopifyDomain" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Los_Angeles',
    "retentionDays" INTEGER NOT NULL DEFAULT 30,
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
