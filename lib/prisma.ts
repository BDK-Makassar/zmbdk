import { PrismaClient } from "@prisma/client";

// Pola standar Next.js + Prisma di lingkungan serverless: pakai satu instance
// yang disimpan di global object supaya tidak bikin koneksi baru tiap
// hot-reload (dev) atau tiap cold start function (production).

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
