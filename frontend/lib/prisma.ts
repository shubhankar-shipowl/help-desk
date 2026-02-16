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

  // Validate required variables
  if (!dbUser || !dbPassword || !dbName) {
    throw new Error(
      'Database configuration missing. Please set either DATABASE_URL or all of: DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME'
    );
  }

  // URL encode password to handle special characters
  const encodedPassword = encodeURIComponent(dbPassword);
  
  // Construct MySQL connection URL
  const databaseUrl = `mysql://${dbUser}:${encodedPassword}@${dbHost}:${dbPort}/${dbName}`;
  
  // Add connection timeout and pool parameters
  // - connect_timeout: time to establish connection (seconds)
  // - pool_timeout: time to wait for a connection from the pool (seconds)
  // - socket_timeout: time for socket operations (seconds)
  // - connection_limit: max connections in the pool
  const connectionParams = 'connect_timeout=15&pool_timeout=30&socket_timeout=60&connection_limit=20';
  return databaseUrl.includes('?')
    ? `${databaseUrl}&${connectionParams}`
    : `${databaseUrl}?${connectionParams}`;
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    errorFormat: "pretty",
    datasources: {
      db: {
        url: getDatabaseUrl(),
      },
    },
    // Optimize connection pool settings
    // Increase connection limit and timeout to handle concurrent operations
    // These values can be adjusted based on your database server capacity
    // Note: Connection pool settings are configured via DATABASE_URL query params
    // Example: mysql://user:pass@host:port/db?connection_limit=20&pool_timeout=20
  });

// Verify Email model exists (for development debugging)
if (process.env.NODE_ENV === "development" && !prisma.email) {
  console.warn("[Prisma] Email model not found in Prisma Client. Please restart the server after running: npx prisma generate");
}

// Prisma connects lazily on first query, so we don't need to call $connect() here
// Connection errors will be handled at the query level

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
