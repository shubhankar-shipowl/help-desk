export function validateEnv(): void {
  const required = ['NEXTAUTH_SECRET'];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.warn(`[Facebook Service] Missing env vars: ${missing.join(', ')}`);
  }

  const recommended = ['FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET', 'FACEBOOK_VERIFY_TOKEN'];
  const missingRecommended = recommended.filter((key) => !process.env[key]);

  if (missingRecommended.length > 0) {
    console.warn(`[Facebook Service] Missing Facebook config: ${missingRecommended.join(', ')}`);
  }
}
