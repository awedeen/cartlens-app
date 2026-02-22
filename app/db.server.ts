import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

// Singleton in all environments — prevents multiple PrismaClient instances
// from accumulating in dev (HMR) and ensures a single connection pool in prod.
if (!globalThis.__prisma) {
  globalThis.__prisma = new PrismaClient();
}

const prisma = globalThis.__prisma;

export default prisma;
