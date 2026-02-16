/**
 * Validate required environment variables
 */
export function validateEnv(): void {
  const required = [
    'NEXTAUTH_SECRET',
    'INTERNAL_API_KEY',
  ];

  // Either DATABASE_URL or individual DB vars are required
  const hasDatabaseUrl = !!process.env.DATABASE_URL;
  const hasDbVars = !!(process.env.DB_USER && process.env.DB_PASSWORD && process.env.DB_NAME);

  if (!hasDatabaseUrl && !hasDbVars) {
    throw new Error(
      'Database configuration missing. Set either DATABASE_URL or all of: DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME'
    );
  }

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`
    );
  }

  console.log('[Email Service] Environment validated');
}
