import jwt from 'jsonwebtoken';

export interface AccessTokenPayload {
  userId: string;
  username: string;
}

const ISSUER = 'extract.io';
const TOKEN_TTL = '30d';

export function signAccessToken(payload: AccessTokenPayload, secret: string): string {
  return jwt.sign({ username: payload.username }, secret, {
    subject: payload.userId,
    issuer: ISSUER,
    expiresIn: TOKEN_TTL,
    algorithm: 'HS256',
  });
}

/** Returns the payload, or null when the token is missing, expired or forged. */
export function verifyAccessToken(token: string, secret: string): AccessTokenPayload | null {
  try {
    const decoded = jwt.verify(token, secret, { issuer: ISSUER, algorithms: ['HS256'] });
    if (typeof decoded !== 'object' || decoded === null) return null;
    const sub = decoded.sub;
    const username = (decoded as Record<string, unknown>).username;
    if (typeof sub !== 'string' || typeof username !== 'string') return null;
    return { userId: sub, username };
  } catch {
    return null;
  }
}
