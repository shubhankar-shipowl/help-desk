import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaVersion?: string;
};

// In development, clear cached Prisma client if schema has changed
// This ensures new enum values are picked up without server restart
if (process.env.NODE_ENV === "development") {
  const currentSchemaVersion = "1.0.4"; // Increment this when schema changes (added Email model)
  const existingPrisma = globalForPrisma.prisma;
  if (existingPrisma && globalForPrisma.prismaVersion !== currentSchemaVersion) {
    console.log("[Prisma] Schema changed, recreating Prisma client...");
    existingPrisma.$disconnect().catch(() => {
      // Ignore disconnect errors
    });
    globalForPrisma.prisma = undefined;
  }
  // Force clear if Email model doesn't exist
  const currentPrisma = globalForPrisma.prisma;
  if (currentPrisma) {
    const hasEmailModel = 'email' in currentPrisma;
    if (!hasEmailModel) {
      console.log("[Prisma] Email model missing, recreating Prisma client...");
      (currentPrisma as PrismaClient).$disconnect().catch(() => {
        // Ignore disconnect errors
      });
      globalForPrisma.prisma = undefined;
    }
  }
  globalForPrisma.prismaVersion = currentSchemaVersion;
}

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

function createPrismaClient(): PrismaClient {
  try {
    return new PrismaClient({
      log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
      errorFormat: "pretty",
      datasources: {
        db: {
          url: getDatabaseUrl(),
        },
      },
    });
  } catch (e) {
    console.warn('[Prisma] Failed to create PrismaClient during build:', e);
    // Return a bare PrismaClient so the module can still be imported at build time.
    // Any actual query at runtime will fail with a clear connection error.
    return new PrismaClient();
  }
}

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? createPrismaClient();

// Verify Email model exists (for development debugging)
if (process.env.NODE_ENV === "development" && prisma && (prisma as any).email === undefined) {
  try {
    console.warn("[Prisma] Email model not found in Prisma Client. Please restart the server after running: npx prisma generate");
  } catch {
    // Ignore
  }
}

// Prisma connects lazily on first query, so we don't need to call $connect() here
// Connection errors will be handled at the query level

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
