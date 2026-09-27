import { Prisma, PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { __extractPrisma?: PrismaClient };

/** Process-wide PrismaClient singleton (survives hot reloads in dev). */
export function getPrisma(): PrismaClient {
  if (!globalForPrisma.__extractPrisma) {
    globalForPrisma.__extractPrisma = new PrismaClient({
      log: process.env.PRISMA_LOG === 'query' ? ['query', 'warn', 'error'] : ['warn', 'error'],
    });
  }
  return globalForPrisma.__extractPrisma;
}

export type Tx = Prisma.TransactionClient;

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/** Errors worth retrying (connection loss, timeouts, serialization conflicts). */
export function isTransientDbError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientInitializationError) return true;
  if (err instanceof Prisma.PrismaClientRustPanicError) return true;
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return ['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2034'].includes(err.code);
  }
  if (err instanceof Prisma.PrismaClientUnknownRequestError) return true;
  return false;
}
