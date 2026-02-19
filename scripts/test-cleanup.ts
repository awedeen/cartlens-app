/**
 * Test script for data retention cleanup.
 *
 * Success requirements:
 * 1. Old CartSession (100 days) + CartEvents are deleted
 * 2. Recent CartSession (1 day) is preserved
 * 3. CartEvents cascade-delete with their session
 * 4. runCleanup() reports the correct deleted count
 *
 * Self-contained: creates and tears down a test shop + sessions.
 * Run: npx tsx scripts/test-cleanup.ts
 */

import prisma from "../app/db.server";
import { runCleanup } from "../app/services/cleanup.server";

async function main() {
  console.log("=== CartLens Data Retention Cleanup Test ===\n");

  // --- Setup: create isolated test shop ---
  const testShop = await prisma.shop.create({
    data: {
      shopifyDomain: "__test-cleanup__.myshopify.com",
      retentionDays: 90,
      timezone: "UTC",
    },
  });
  console.log(`[Setup] Test shop: ${testShop.id}`);

  // --- Old session: 100 days ago (SHOULD be deleted) ---
  const oldDate = new Date();
  oldDate.setDate(oldDate.getDate() - 100);

  const oldSession = await prisma.cartSession.create({
    data: {
      shopId: testShop.id,
      visitorId: "test-old-visitor",
      cartCreated: true,
      createdAt: oldDate,
      updatedAt: oldDate,
    },
  });
  const oldEvent = await prisma.cartEvent.create({
    data: {
      sessionId: oldSession.id,
      eventType: "cart_add",
      productTitle: "Test Product",
      timestamp: oldDate,
    },
  });
  console.log(`[Setup] Old session (100 days):   ${oldSession.id}`);
  console.log(`[Setup] Old event:                ${oldEvent.id}`);

  // --- Recent session: 1 day ago (should NOT be deleted) ---
  const recentDate = new Date();
  recentDate.setDate(recentDate.getDate() - 1);

  const recentSession = await prisma.cartSession.create({
    data: {
      shopId: testShop.id,
      visitorId: "test-recent-visitor",
      cartCreated: true,
      createdAt: recentDate,
      updatedAt: recentDate,
    },
  });
  console.log(`[Setup] Recent session (1 day):   ${recentSession.id}\n`);

  // --- Run cleanup ---
  console.log("[Running] runCleanup()...");
  const results = await runCleanup();
  const shopResult = results.find(r => r.shop === testShop.shopifyDomain);
  const deletedCount = shopResult?.deleted ?? 0;
  console.log(`[Result]  Reported deleted: ${deletedCount}\n`);

  // --- Assertions ---
  const oldSessionCheck  = await prisma.cartSession.findUnique({ where: { id: oldSession.id } });
  const oldEventCheck    = await prisma.cartEvent.findUnique({ where: { id: oldEvent.id } });
  const recentCheck      = await prisma.cartSession.findUnique({ where: { id: recentSession.id } });

  const tests = [
    { name: "Old session (100d) deleted",          pass: oldSessionCheck === null },
    { name: "Old CartEvent cascade-deleted",        pass: oldEventCheck === null },
    { name: "Recent session (1d) preserved",        pass: recentCheck !== null },
    { name: "Deleted count = 1",                    pass: deletedCount === 1 },
  ];

  let allPassed = true;
  for (const t of tests) {
    const icon = t.pass ? "✓" : "✗";
    const label = t.pass ? "PASS" : "FAIL";
    console.log(`${icon} ${label}: ${t.name}`);
    if (!t.pass) allPassed = false;
  }

  // --- Teardown ---
  await prisma.shop.delete({ where: { id: testShop.id } }); // cascades sessions + events
  console.log("\n[Teardown] Test shop and all data removed");

  console.log(`\n=== ${allPassed ? "ALL TESTS PASSED ✓" : "TESTS FAILED ✗"} ===`);
  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error("\nUnexpected error:", err);
  process.exit(1);
});
