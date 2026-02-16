export function validateEnv(): void {
  const required = ['NEXTAUTH_SECRET'];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.warn(`[Order Tracking Service] Missing env vars: ${missing.join(', ')}`);
  }
}
