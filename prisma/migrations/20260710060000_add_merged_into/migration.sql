-- AlterTable
ALTER TABLE "CartSession" ADD COLUMN     "mergedInto" TEXT;

-- CreateIndex
CREATE INDEX "CartSession_shopId_mergedInto_idx" ON "CartSession"("shopId", "mergedInto");
