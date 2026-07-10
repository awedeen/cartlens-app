import prisma from "../db.server";

// Fallback retention when a shop has no explicit setting.
const DEFAULT_RETENTION_DAYS = 90;

/**
 * Deletes CartSessions (and cascading CartEvents) older than each shop's
 * configured retention (Shop.retentionDays). Returns a summary for logging.
 *
 * Called by scripts/cleanup.ts — triggered externally (Railway Cron, manual, etc.)
 */
export async function runCleanup(): Promise<{ shop: string; deleted: number }[]> {
  const shops = await prisma.shop.findMany({
    select: { id: true, shopifyDomain: true, retentionDays: true },
  });

  const results: { shop: string; deleted: number }[] = [];

  for (const shop of shops) {
    // Per-shop retention — honor the configurable setting, not a global constant.
    const retentionDays = shop.retentionDays ?? DEFAULT_RETENTION_DAYS;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);

    const { count } = await prisma.cartSession.deleteMany({
      where: {
        shopId: shop.id,
        createdAt: { lt: cutoff },
      },
    });

    if (count > 0) {
      console.log(`[Cleanup] ${shop.shopifyDomain}: deleted ${count} session(s) older than ${retentionDays} days`);
    }

    results.push({ shop: shop.shopifyDomain, deleted: count });
  }

  const totalDeleted = results.reduce((sum, r) => sum + r.deleted, 0);
  console.log(`[Cleanup] Done — ${totalDeleted} total session(s) deleted across ${shops.length} shop(s)`);

  return results;
}
