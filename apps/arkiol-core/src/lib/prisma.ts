// src/lib/prisma.ts
// Safe Prisma singleton — instantiated only when DATABASE_URL is configured.
// Callers that need the DB should check detectCapabilities().database first;
// this client returns stub rejections instead of throwing at import time.
import { detectCapabilities, bootstrapEnv } from '@arkiol/shared';

const nodeEnv = bootstrapEnv('NODE_ENV');

let _prisma: any = null;

function createPrismaClient() {
  try {
    const { PrismaClient } = require('@prisma/client');
    return new PrismaClient({
      log: nodeEnv === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });
  } catch {
    return null;
  }
}

const globalForPrisma = globalThis as any;

// Stub returned for every property when DATABASE_URL is absent.
// Returns a rejected promise so callers get a clear error rather than a crash.
const DB_NOT_CONFIGURED = new Proxy(
  (() => Promise.reject(new Error('Database not configured. Add DATABASE_URL to your environment variables.'))) as any,
  { get: () => DB_NOT_CONFIGURED }
);

export const prisma: any = new Proxy({} as any, {
  get(_target, prop) {
    if (!_prisma) {
      if (!detectCapabilities().database) {
        return DB_NOT_CONFIGURED;
      }
      _prisma = globalForPrisma.prisma ?? createPrismaClient();
      if (_prisma && nodeEnv !== 'production') {
        globalForPrisma.prisma = _prisma;
      }
    }
    return _prisma ? (_prisma as any)[prop] : DB_NOT_CONFIGURED;
  },
});
