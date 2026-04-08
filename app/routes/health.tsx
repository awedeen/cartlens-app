// Health check endpoint — GET /health
// Used by Railway for zero-downtime deploy checks and external uptime monitors.
// Returns 200 + DB status when healthy, 503 when DB is unreachable.

import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";

export const loader = async (_: LoaderFunctionArgs) => {
  try {
    // Lightweight DB ping — just checks connectivity
    await prisma.$queryRaw`SELECT 1`;

    return new Response(
      JSON.stringify({ status: "ok", db: "connected", ts: new Date().toISOString() }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("[Health] DB check failed:", err);
    return new Response(
      JSON.stringify({ status: "error", db: "unreachable", ts: new Date().toISOString() }),
      {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};
