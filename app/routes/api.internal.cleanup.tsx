// Internal cleanup trigger endpoint — POST /api/internal/cleanup
// Called by Railway Cron on a schedule (e.g. daily at 3 AM UTC).
// Protected by CLEANUP_SECRET env var — requests without it are rejected.
//
// Railway Cron config:
//   Schedule: 0 3 * * *
//   Command: curl -X POST https://cartlens-app-production.up.railway.app/api/internal/cleanup \
//              -H "x-cleanup-secret: $CLEANUP_SECRET"

import type { ActionFunctionArgs } from "react-router";
import { runCleanup } from "../services/cleanup.server";
import prisma from "../db.server";
import { logger } from "../services/logger.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

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
