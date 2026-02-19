/**
 * Data retention cleanup script.
 * Run via: npx tsx scripts/cleanup.ts
 *
 * Triggered by Railway Cron Service on a schedule.
 * The app process is not involved — this runs independently.
 */

import { runCleanup } from "../app/services/cleanup.server";
import prisma from "../app/db.server";

async function main() {
  console.log(`[Cleanup] Starting — ${new Date().toISOString()}`);
  try {
    await runCleanup();
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error("[Cleanup] Fatal error:", err);
  process.exit(1);
});
