import prisma from "../db.server";

// All cart sessions older than this are deleted on the nightly cleanup run.
const RETENTION_DAYS = 90;

/**
 * Deletes CartSessions (and cascading CartEvents) older than RETENTION_DAYS.
 * Returns a summary of what was deleted for logging.
 *
 * Called by scripts/cleanup.ts — triggered externally (Railway Cron, manual, etc.)
 */
export async function runCleanup(): Promise<{ shop: string; deleted: number }[]> {
  const shops = await prisma.shop.findMany({
    select: { id: true, shopifyDomain: true },
  });

  const results: { shop: string; deleted: number }[] = [];

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

  for (const shop of shops) {
    const { count } = await prisma.cartSession.deleteMany({
      where: {
        shopId: shop.id,
        createdAt: { lt: cutoff },
      },
    });

    if (count > 0) {
      console.log(`[Cleanup] ${shop.shopifyDomain}: deleted ${count} session(s) older than ${RETENTION_DAYS} days`);
    }

    results.push({ shop: shop.shopifyDomain, deleted: count });
  }

  const totalDeleted = results.reduce((sum, r) => sum + r.deleted, 0);
  console.log(`[Cleanup] Done — ${totalDeleted} total session(s) deleted across ${shops.length} shop(s)`);

  return results;
}
