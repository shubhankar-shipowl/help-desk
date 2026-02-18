import { PrismaClient } from '@prisma/client';

export function getDatabaseUrl(): string {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  const dbHost = process.env.DB_HOST || 'localhost';
  const dbPort = process.env.DB_PORT || '3306';
  const dbUser = process.env.DB_USER;
  const dbPassword = process.env.DB_PASSWORD;
  const dbName = process.env.DB_NAME;

  if (!dbUser || !dbPassword || !dbName) {
    throw new Error(
      'Database configuration missing. Set either DATABASE_URL or DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME'
    );
  }

  const encodedPassword = encodeURIComponent(dbPassword);
  const databaseUrl = `mysql://${dbUser}:${encodedPassword}@${dbHost}:${dbPort}/${dbName}`;
  const connectionParams = 'connect_timeout=15&pool_timeout=30&socket_timeout=60&connection_limit=10';
  return `${databaseUrl}?${connectionParams}`;
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export function createPrismaClient(): PrismaClient {
  if (globalForPrisma.prisma) {
    return globalForPrisma.prisma;
  }

  const client = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    errorFormat: 'pretty',
    datasources: {
      db: {
        url: getDatabaseUrl(),
      },
    },
  });

  if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = client;
  }

  return client;
}

export const prisma = createPrismaClient();

// Graceful shutdown - close DB connections when process exits
process.on('SIGTERM', async () => {
  await prisma.$disconnect();
});

process.on('SIGINT', async () => {
  await prisma.$disconnect();
});
