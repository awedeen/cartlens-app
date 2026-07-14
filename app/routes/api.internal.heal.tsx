// Internal heal trigger endpoint — POST /api/internal/heal
// One-time (idempotent) repair of converted carts corrupted by post-conversion
// writes (see heal.server.ts). Protected by the same CLEANUP_SECRET as
// /api/internal/cleanup.
//
//   Dry run (preview + inspect the corrupted records, no changes):
//     curl -X POST https://<app>/api/internal/heal \
//       -H "x-cleanup-secret: $CLEANUP_SECRET" -H "x-dry-run: 1"
//
//   Execute the heal:
//     curl -X POST https://<app>/api/internal/heal \
//       -H "x-cleanup-secret: $CLEANUP_SECRET"

import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { logger } from "../services/logger.server";
import { healConvertedSessions } from "../services/heal.server";

// Return 405 for non-POST methods — action is POST-only.
export const loader = async () => {
  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers: { "Content-Type": "application/json" },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const secret = request.headers.get("x-cleanup-secret");
  const expectedSecret = process.env.CLEANUP_SECRET;

  if (!expectedSecret) {
    logger.error("Heal", "CLEANUP_SECRET env var not set — refusing to run");
    return new Response(JSON.stringify({ error: "Server misconfiguration" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!secret || secret !== expectedSecret) {
    logger.warn("Heal", "Unauthorized heal attempt — invalid secret");
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Dry run by header (x-dry-run: 1) or ?dryRun=1 — reports without mutating.
  const url = new URL(request.url);
  const dryRun =
    request.headers.get("x-dry-run") === "1" ||
    url.searchParams.get("dryRun") === "1";

  try {
    logger.info("Heal", `Starting${dryRun ? " (dry run)" : ""} converted-cart heal`);
    const report = await healConvertedSessions({ dryRun });
    logger.info(
      "Heal",
      `Done${dryRun ? " (dry run)" : ""} — ${report.healedCount}/${report.scanned} corrupted, ${report.eventsStripped} event(s) stripped`,
    );

    return new Response(JSON.stringify(report, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    logger.error("Heal", "Fatal error during heal", { error: err?.message });
    return new Response(JSON.stringify({ error: "Heal failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  } finally {
    await prisma.$disconnect();
  }
};
