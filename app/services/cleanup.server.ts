import cron from "node-cron";
import prisma from "../db.server";

/**
 * Deletes CartSessions (and cascading CartEvents) older than each shop's retentionDays.
 * Returns a summary of what was deleted for logging.
 */
export async function runCleanup(): Promise<{ shop: string; deleted: number }[]> {
  const shops = await prisma.shop.findMany({
    select: { id: true, shopifyDomain: true, retentionDays: true },
  });

  const results: { shop: string; deleted: number }[] = [];

  for (const shop of shops) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - shop.retentionDays);

    const { count } = await prisma.cartSession.deleteMany({
      where: {
        shopId: shop.id,
        createdAt: { lt: cutoff },
      },
    });

    if (count > 0) {
      console.log(`[Cleanup] ${shop.shopifyDomain}: deleted ${count} session(s) older than ${shop.retentionDays} days`);
    }

    results.push({ shop: shop.shopifyDomain, deleted: count });
  }

  const totalDeleted = results.reduce((sum, r) => sum + r.deleted, 0);
  console.log(`[Cleanup] Done — ${totalDeleted} total session(s) deleted across ${shops.length} shop(s)`);

  return results;
}

/**
 * Starts the daily cleanup cron. Uses a global guard so it only initializes once
 * even in hot-reload environments.
 */
export function startCleanupCron(): void {
  if ((global as any).__cleanupCronStarted) return;
  (global as any).__cleanupCronStarted = true;

  // Run daily at 2:00 AM UTC
  cron.schedule("0 2 * * *", async () => {
    console.log("[Cleanup] Running scheduled data retention cleanup...");
    try {
      await runCleanup();
    } catch (err) {
      console.error("[Cleanup] Error during cleanup:", err);
    }
  }, { timezone: "UTC" });

  console.log("[Cleanup] Cron scheduled — daily at 2:00 AM UTC");
}
