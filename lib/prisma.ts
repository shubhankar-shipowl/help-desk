import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaVersion?: string;
};

// In development, clear cached Prisma client if schema has changed
// This ensures new enum values are picked up without server restart
if (process.env.NODE_ENV === "development") {
  const currentSchemaVersion = "1.0.3"; // Increment this when schema changes (added channelOrderNumber field)
  if (globalForPrisma.prisma && globalForPrisma.prismaVersion !== currentSchemaVersion) {
    console.log("[Prisma] Schema changed, recreating Prisma client...");
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
  });

// Add connection error handling
prisma.$connect().catch((error) => {
  console.error("Failed to connect to database:", error.message);
  if (process.env.NODE_ENV === "development") {
    console.error("Database connection error details:", error);
  }
});

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
