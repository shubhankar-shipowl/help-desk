import { Request, Response, NextFunction } from 'express';
import { jwtDecrypt } from 'jose';
import hkdf from '@panva/hkdf';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        name: string;
        role: string;
        tenantId: string;
      };
    }
  }
}

async function getDerivedEncryptionKey(secret: string): Promise<Uint8Array> {
  return await hkdf(
    'sha256',
    secret,
    '',
    'NextAuth.js Generated Encryption Key',
    32
  );
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret) {
      res.status(500).json({ error: 'Server configuration error' });
      return;
    }

    const token =
      req.cookies['next-auth.session-token'] ||
      req.cookies['__Secure-next-auth.session-token'];

    if (!token) {
      res.status(401).json({ error: 'Unauthorized - No session token' });
      return;
    }

    const encryptionKey = await getDerivedEncryptionKey(secret);

    const { payload } = await jwtDecrypt(token, encryptionKey, {
      clockTolerance: 15,
    });

    const user = {
      id: payload.sub || (payload as any).id || '',
      email: (payload as any).email || '',
      name: (payload as any).name || '',
      role: (payload as any).role || '',
      tenantId: (payload as any).tenantId || '',
    };

    if (!user.id) {
      res.status(401).json({ error: 'Unauthorized - Invalid token payload' });
      return;
    }

    req.user = user;
    next();
  } catch (error: any) {
    console.error('[Auth] Token decryption failed:', error.message);
    res.status(401).json({ error: 'Unauthorized - Invalid or expired session' });
  }
}

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  if (req.user.role !== 'ADMIN') {
    res.status(403).json({ error: 'Forbidden - Admin role required' });
    return;
  }

  next();
}

export function requireAgentOrAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  if (req.user.role !== 'ADMIN' && req.user.role !== 'AGENT') {
    res.status(403).json({ error: 'Forbidden - Admin or Agent role required' });
    return;
  }

  next();
}
