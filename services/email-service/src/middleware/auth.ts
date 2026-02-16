import { Request, Response, NextFunction } from 'express';
import { jwtDecrypt } from 'jose';
import hkdf from '@panva/hkdf';

// Extend Express Request to include user
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

/**
 * Derive the encryption key from NEXTAUTH_SECRET
 * NextAuth v4 uses JWE (encrypted), NOT signed JWTs
 * Key is derived via HKDF with specific NextAuth parameters
 */
async function getDerivedEncryptionKey(secret: string): Promise<Uint8Array> {
  return await hkdf(
    'sha256',
    secret,
    '',
    'NextAuth.js Generated Encryption Key',
    32
  );
}

/**
 * Auth middleware that decrypts NextAuth JWE tokens
 * Expects the session token from forwarded cookies
 */
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

    // Get session token from cookies (forwarded by Next.js rewrites)
    // NextAuth uses different cookie names in production vs development
    const token =
      req.cookies['next-auth.session-token'] ||
      req.cookies['__Secure-next-auth.session-token'];

    if (!token) {
      res.status(401).json({ error: 'Unauthorized - No session token' });
      return;
    }

    // Derive encryption key
    const encryptionKey = await getDerivedEncryptionKey(secret);

    // Decrypt the JWE token
    const { payload } = await jwtDecrypt(token, encryptionKey, {
      clockTolerance: 15,
    });

    // Extract user info from payload
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

/**
 * Middleware that requires ADMIN or AGENT role
 */
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
