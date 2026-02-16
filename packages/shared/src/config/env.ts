export interface EnvValidationOptions {
  serviceName: string;
  requiredVars?: string[];
  optionalWarnings?: { key: string; message: string }[];
}

export function validateEnv(options: EnvValidationOptions): void {
  const { serviceName, requiredVars = [], optionalWarnings = [] } = options;

  // Database is always required
  const hasDatabaseUrl = !!process.env.DATABASE_URL;
  const hasDbVars = !!(process.env.DB_USER && process.env.DB_PASSWORD && process.env.DB_NAME);

  if (!hasDatabaseUrl && !hasDbVars) {
    throw new Error(
      'Database configuration missing. Set either DATABASE_URL or all of: DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME'
    );
  }

  // Check required vars
  const missing = requiredVars.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`
    );
  }

  // Warn about optional vars
  for (const { key, message } of optionalWarnings) {
    if (!process.env[key]) {
      console.warn(`[${serviceName}] Warning: ${message}`);
    }
  }

  console.log(`[${serviceName}] Environment validated`);
}
