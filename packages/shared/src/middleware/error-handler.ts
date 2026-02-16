import { Request, Response, NextFunction } from 'express';

export function createErrorHandler(serviceName: string) {
  return function errorHandler(
    err: any,
    req: Request,
    res: Response,
    _next: NextFunction
  ): void {
    console.error(`[${serviceName}] Error on ${req.method} ${req.path}:`, err.message);
    if (process.env.NODE_ENV === 'development') {
      console.error(err.stack);
    }

    const statusCode = err.statusCode || 500;
    const message = err.message || 'Internal server error';

    res.status(statusCode).json({ error: message });
  };
}
