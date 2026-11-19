import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createHash, randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { HttpError } from './http.js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: { id: string; sid: string };
  }
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const hashPassword = (pw: string) => bcrypt.hash(pw, 11);
export const checkPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

export function signAccess(userId: string, sid: string): string {
  return jwt.sign({ sub: userId, sid, t: 'access' }, config.JWT_ACCESS_SECRET, { expiresIn: `${config.ACCESS_TTL_MIN}m` });
}

/** Short-lived signed token embedded in a push so notification buttons work without a login session. */
export function signAction(userId: string, jobId: string): string {
  return jwt.sign({ sub: userId, job: jobId, t: 'action' }, config.JWT_ACCESS_SECRET, { expiresIn: '6h' });
}
export function verifyAction(token: string): { userId: string; jobId: string } {
  try {
    const p = jwt.verify(token, config.JWT_ACCESS_SECRET) as { sub: string; job: string; t: string };
    if (p.t !== 'action') throw new Error('wrong type');
    return { userId: p.sub, jobId: p.job };
  } catch {
    throw new HttpError(401, 'Invalid or expired action token', 'bad_action_token');
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return next(new HttpError(401, 'Missing bearer token', 'unauthenticated'));
  try {
    const p = jwt.verify(h.slice(7), config.JWT_ACCESS_SECRET) as { sub: string; sid: string; t: string };
    if (p.t !== 'access') throw new Error('wrong type');
    req.user = { id: p.sub, sid: p.sid };
    next();
  } catch {
    next(new HttpError(401, 'Invalid or expired token', 'unauthenticated'));
  }
}

export const uid = (req: Request): string => {
  if (!req.user) throw new HttpError(401, 'Unauthenticated', 'unauthenticated');
  return req.user.id;
};
