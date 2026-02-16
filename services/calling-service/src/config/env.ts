export function validateEnv(): void {
  const required = ['NEXTAUTH_SECRET'];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.warn(`[Calling Service] Missing env vars: ${missing.join(', ')}`);
  }

  const recommended = ['EXOTEL_SID', 'EXOTEL_KEY', 'EXOTEL_TOKEN', 'CALLER_ID'];
  const missingRecommended = recommended.filter((key) => !process.env[key]);

  if (missingRecommended.length > 0) {
    console.warn(`[Calling Service] Missing Exotel config: ${missingRecommended.join(', ')}`);
  }
}
