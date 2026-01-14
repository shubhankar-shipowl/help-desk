import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaVersion?: string;
};

// In development, clear cached Prisma client if schema has changed
// This ensures new enum values are picked up without server restart
if (process.env.NODE_ENV === "development") {
  const currentSchemaVersion = "1.0.4"; // Increment this when schema changes (added Email model)
  if (globalForPrisma.prisma && globalForPrisma.prismaVersion !== currentSchemaVersion) {
    console.log("[Prisma] Schema changed, recreating Prisma client...");
    globalForPrisma.prisma.$disconnect().catch(() => {
      // Ignore disconnect errors
    });
    globalForPrisma.prisma = undefined;
  }
  // Force clear if Email model doesn't exist
  if (globalForPrisma.prisma && !('email' in globalForPrisma.prisma)) {
    console.log("[Prisma] Email model missing, recreating Prisma client...");
    globalForPrisma.prisma.$disconnect().catch(() => {
      // Ignore disconnect errors
    });
    globalForPrisma.prisma = undefined;
  }
  globalForPrisma.prismaVersion = currentSchemaVersion;
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    errorFormat: "pretty",
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
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
