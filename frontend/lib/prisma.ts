/**
 * Lazy Prisma Client
 *
 * All imports and instantiation are deferred to first property access via a Proxy.
 * This ensures the module can be safely imported during `next build` even when
 * @prisma/client is not generated or the database is unreachable.
 * At runtime the real PrismaClient is created once and cached in globalThis.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: any | undefined;
  prismaVersion?: string;
};

/**
 * Construct DATABASE_URL from individual DB_* environment variables if available
 * Falls back to DATABASE_URL if individual variables are not set
 *
 * Environment variables used (if DATABASE_URL is not set):
 * - DB_HOST (default: localhost)
 * - DB_PORT (default: 3306)
 * - DB_USER (required)
 * - DB_PASSWORD (required)
 * - DB_NAME (required)
 */
export function getDatabaseUrl(): string {
  // If DATABASE_URL is explicitly set, use it
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  // Otherwise, construct from individual DB_* variables
  const dbHost = process.env.DB_HOST || 'localhost';
  const dbPort = process.env.DB_PORT || '3306';
  const dbUser = process.env.DB_USER;
  const dbPassword = process.env.DB_PASSWORD;
  const dbName = process.env.DB_NAME;

  // During Next.js build, database env vars may not be available.
  // Return a placeholder URL so PrismaClient can be constructed without throwing.
  // Prisma connects lazily on first query, so this won't cause issues at build time.
  if (!dbUser || !dbPassword || !dbName) {
    console.warn(
      '[Prisma] Database configuration missing. Using placeholder URL for build. ' +
      'Set DATABASE_URL or DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME at runtime.'
    );
    return 'mysql://placeholder:placeholder@localhost:3306/placeholder';
  }

  // URL encode password to handle special characters
  const encodedPassword = encodeURIComponent(dbPassword);

  // Construct MySQL connection URL
  const databaseUrl = `mysql://${dbUser}:${encodedPassword}@${dbHost}:${dbPort}/${dbName}`;

  // Add connection timeout and pool parameters
  const connectionParams = 'connect_timeout=15&pool_timeout=30&socket_timeout=60&connection_limit=20';
  return databaseUrl.includes('?')
    ? `${databaseUrl}&${connectionParams}`
    : `${databaseUrl}?${connectionParams}`;
}

function getOrCreatePrismaClient(): any {
  if (globalForPrisma.prisma) {
    return globalForPrisma.prisma;
  }

  const { PrismaClient } = require('@prisma/client');

  // In development, clear cached Prisma client if schema has changed
  if (process.env.NODE_ENV === "development") {
    const currentSchemaVersion = "1.0.4";
    if (globalForPrisma.prismaVersion !== currentSchemaVersion) {
      globalForPrisma.prisma = undefined;
    }
    globalForPrisma.prismaVersion = currentSchemaVersion;
  }

  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = new PrismaClient({
      log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
      errorFormat: "pretty",
      datasources: {
        db: {
          url: getDatabaseUrl(),
        },
      },
    });
  }

  if (process.env.NODE_ENV !== "production") {
    // Keep reference in globalThis so it's reused across hot reloads
    globalForPrisma.prisma = globalForPrisma.prisma;
  }

  return globalForPrisma.prisma;
}

// Export a Proxy so that `import { prisma } from './prisma'` never triggers
// PrismaClient loading at module evaluation time. The real client is created
// only when a property (e.g. prisma.user) is first accessed at request time.
export const prisma: import("@prisma/client").PrismaClient = new Proxy(
  {} as any,
  {
    get(_target, prop) {
      const client = getOrCreatePrismaClient();
      return client[prop];
    },
  }
);
