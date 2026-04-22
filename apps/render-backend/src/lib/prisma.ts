// apps/render-backend/src/lib/prisma.ts
//
// The Render service shares the same Postgres as the Vercel frontend
// and reads job rows by primary key. We instantiate one PrismaClient
// per process (Prisma's standard pattern).
import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __renderPrisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.__renderPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['error', 'warn'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__renderPrisma = prisma;
}
