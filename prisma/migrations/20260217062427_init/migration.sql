-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopifyDomain" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "retentionDays" INTEGER NOT NULL DEFAULT 90,
    "cartlinkEnabled" BOOLEAN NOT NULL DEFAULT false,
    "botFilterEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CartSession" (
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
    "cartTotal" REAL NOT NULL DEFAULT 0,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "isSuspectedBot" BOOLEAN NOT NULL DEFAULT false,
    "botReason" TEXT,
    "merchantOverride" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CartSession_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CartEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "productId" TEXT,
    "productTitle" TEXT,
    "variantId" TEXT,
    "variantTitle" TEXT,
    "variantImage" TEXT,
    "quantity" INTEGER,
    "price" REAL,
    "pageUrl" TEXT,
    "pageTitle" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CartEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CartSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ShopSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "visibleColumns" TEXT NOT NULL DEFAULT '[]',
    "excludedProducts" TEXT NOT NULL DEFAULT '[]',
    "excludedCollections" TEXT NOT NULL DEFAULT '[]',
    "botWhitelist" TEXT NOT NULL DEFAULT '[]',
    "botBlacklist" TEXT NOT NULL DEFAULT '[]',
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ShopSettings_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AggregatedStats" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "totalSessions" INTEGER NOT NULL DEFAULT 0,
    "totalCarts" INTEGER NOT NULL DEFAULT 0,
    "totalCheckouts" INTEGER NOT NULL DEFAULT 0,
    "totalOrders" INTEGER NOT NULL DEFAULT 0,
    "totalCartValue" REAL NOT NULL DEFAULT 0,
    "totalOrderValue" REAL NOT NULL DEFAULT 0,
    "uniqueProducts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AggregatedStats_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Shop_shopifyDomain_key" ON "Shop"("shopifyDomain");

-- CreateIndex
CREATE INDEX "CartSession_shopId_idx" ON "CartSession"("shopId");

-- CreateIndex
CREATE INDEX "CartSession_shopId_createdAt_idx" ON "CartSession"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX "CartSession_visitorId_idx" ON "CartSession"("visitorId");

-- CreateIndex
CREATE INDEX "CartEvent_sessionId_idx" ON "CartEvent"("sessionId");

-- CreateIndex
CREATE INDEX "CartEvent_sessionId_timestamp_idx" ON "CartEvent"("sessionId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "ShopSettings_shopId_key" ON "ShopSettings"("shopId");

-- CreateIndex
CREATE INDEX "AggregatedStats_shopId_idx" ON "AggregatedStats"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "AggregatedStats_shopId_date_key" ON "AggregatedStats"("shopId", "date");
