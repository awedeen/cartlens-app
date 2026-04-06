// Internal cleanup trigger endpoint — POST /api/internal/cleanup
// Secondary HTTP trigger for the 90-day data retention cleanup.
// Primary trigger: Railway Cron service runs `npx tsx scripts/cleanup.ts` directly (0 2 * * *).
// This endpoint is a manual/alternative trigger, protected by CLEANUP_SECRET env var.

import type { ActionFunctionArgs } from "react-router";
import { runCleanup } from "../services/cleanup.server";
import prisma from "../db.server";
import { logger } from "../services/logger.server";

// Return 405 for non-POST methods (GET, etc.) — action is POST-only
export const loader = async () => {
  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers: { "Content-Type": "application/json" },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {

  // Verify secret — must match CLEANUP_SECRET env var
  const secret = request.headers.get("x-cleanup-secret");
  const expectedSecret = process.env.CLEANUP_SECRET;

  if (!expectedSecret) {
    logger.error("Cleanup", "CLEANUP_SECRET env var not set — refusing to run");
    return new Response(JSON.stringify({ error: "Server misconfiguration" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!secret || secret !== expectedSecret) {
    logger.warn("Cleanup", "Unauthorized cleanup attempt — invalid secret");
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    logger.info("Cleanup", "Starting scheduled cleanup");
    const results = await runCleanup();
    const totalDeleted = results.reduce((sum, r) => sum + r.deleted, 0);
    logger.info("Cleanup", `Done — ${totalDeleted} sessions deleted across ${results.length} shops`);

    return new Response(
      JSON.stringify({ success: true, totalDeleted, shops: results }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    logger.error("Cleanup", "Fatal error during cleanup", { error: err?.message });
    return new Response(JSON.stringify({ error: "Cleanup failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  } finally {
    await prisma.$disconnect();
  }
};
