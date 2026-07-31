import { PrismaClient } from '@prisma/client';

/**
 * Prisma client singleton.
 *
 * Next's dev server hot-reloads modules on every edit; without stashing the
 * client on `globalThis` you accumulate a new connection pool per reload and
 * eventually exhaust SQLite's handles.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
