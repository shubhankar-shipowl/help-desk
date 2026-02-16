import { Request, Response, NextFunction } from 'express';

/**
 * Middleware for service-to-service authentication
 * Validates the INTERNAL_API_KEY header for calls from the monolith
 */
export function internalAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const apiKey = req.headers['x-internal-api-key'] as string;
  const expectedKey = process.env.INTERNAL_API_KEY;

  if (!expectedKey) {
    console.error('[Internal Auth] INTERNAL_API_KEY not configured');
    res.status(500).json({ error: 'Server configuration error' });
    return;
  }

  if (!apiKey || apiKey !== expectedKey) {
    res.status(401).json({ error: 'Unauthorized - Invalid API key' });
    return;
  }

  next();
}
