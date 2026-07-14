// One-time (idempotent) heal for converted CartSessions corrupted by
// post-conversion writes.
//
// Before the carts/checkouts webhook handlers learned to LOCK a converted
// session, Shopify's post-purchase traffic on the same cart_token could still
// mutate a completed order:
//   • the post-purchase cart-clear (carts/update with no items) wrote cart_remove
//     events and zeroed itemCount/cartTotal — the "empty converted cart" symptom;
//   • a reused cart_token piled fresh cart_add events onto the order — the
//     "converted cart full of parts they didn't buy" symptom.
//
// The definitive fingerprint of the corruption is any event timestamped AFTER the
// session's checkout_completed marker. This routine strips those events and
// recomputes itemCount/cartTotal from the surviving (pre-conversion) events —
// restoring the cart to exactly what it was at the moment of purchase.
//
// It is idempotent: a clean converted session has no post-conversion events, so
// re-running finds nothing to do. Safe to run repeatedly (and after the webhook
// fix, it simply finds no more corruption).

import prisma from "../db.server";

export interface HealedSession {
  sessionId: string;
  shopDomain: string;
  orderNumber: string | null;
  convertedAt: string;
  /** Events removed because they landed after conversion (the corruption). */
  strippedEvents: { eventType: string; timestamp: string; productTitle: string | null }[];
  before: { itemCount: number; cartTotal: number };
  after: { itemCount: number; cartTotal: number };
}

export interface HealReport {
  dryRun: boolean;
  scanned: number;
  healedCount: number;
  eventsStripped: number;
  healed: HealedSession[];
}

/**
 * Find converted sessions carrying post-conversion events, strip those events,
 * and restore itemCount/cartTotal from what survived. When dryRun is true, it
 * REPORTS exactly what it would change without touching anything — use it to
 * preview (and to eyeball the corrupted records) before committing the heal.
 */
export async function healConvertedSessions(
  { dryRun }: { dryRun: boolean },
): Promise<HealReport> {
  const converted = await prisma.cartSession.findMany({
    where: { orderPlaced: true },
    include: {
      events: { orderBy: { timestamp: "asc" } },
      shop: { select: { shopifyDomain: true } },
    },
  });

  const healed: HealedSession[] = [];
  let eventsStripped = 0;

  for (const s of converted) {
    // Conversion moment = the latest checkout_completed marker. A converted
    // session with no marker (rare legacy data) is left untouched — we can't
    // safely bound "after conversion" without it.
    const completed = s.events.filter((e) => e.eventType === "checkout_completed");
    if (completed.length === 0) continue;
    const convertedAt = completed.reduce(
      (max, e) => (e.timestamp > max ? e.timestamp : max),
      completed[0].timestamp,
    );

    // The corruption: anything after conversion except the completion marker
    // itself (there can be duplicates of it at the same instant — keep those).
    const post = s.events.filter(
      (e) => e.timestamp > convertedAt && e.eventType !== "checkout_completed",
    );
    if (post.length === 0) continue; // already clean

    const postIds = new Set(post.map((e) => e.id));
    const survivors = s.events.filter((e) => !postIds.has(e.id));

    // Rebuild the cart exactly as it stood at purchase, from surviving events.
    let itemCount = 0;
    let cartTotal = 0;
    for (const e of survivors) {
      const qty = e.quantity || 0;
      const price = e.price || 0;
      if (e.eventType === "cart_add") {
        itemCount += qty;
        cartTotal += price * qty;
      } else if (e.eventType === "cart_remove") {
        itemCount -= qty;
        cartTotal -= price * qty;
      }
    }
    itemCount = Math.max(0, itemCount);
    cartTotal = Math.max(0, Math.round(cartTotal * 100) / 100);

    healed.push({
      sessionId: s.id,
      shopDomain: s.shop.shopifyDomain,
      orderNumber: s.orderNumber,
      convertedAt: convertedAt.toISOString(),
      strippedEvents: post.map((e) => ({
        eventType: e.eventType,
        timestamp: e.timestamp.toISOString(),
        productTitle: e.productTitle,
      })),
      before: { itemCount: s.itemCount, cartTotal: s.cartTotal },
      after: { itemCount, cartTotal },
    });
    eventsStripped += post.length;

    if (!dryRun) {
      await prisma.$transaction([
        prisma.cartEvent.deleteMany({ where: { id: { in: [...postIds] } } }),
        prisma.cartSession.update({
          where: { id: s.id },
          data: { itemCount, cartTotal },
        }),
      ]);
    }
  }

  const report: HealReport = {
    dryRun,
    scanned: converted.length,
    healedCount: healed.length,
    eventsStripped,
    healed,
  };
  console.log(
    `[Heal] ${dryRun ? "DRY RUN — " : ""}scanned ${report.scanned} converted session(s), ` +
      `${report.healedCount} corrupted, ${report.eventsStripped} post-conversion event(s) ` +
      `${dryRun ? "would be" : ""} stripped`,
  );
  return report;
}
