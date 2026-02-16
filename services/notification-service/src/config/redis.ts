export function getRedisUrl(): string {
  return process.env.REDIS_URL || 'redis://localhost:6379';
}
