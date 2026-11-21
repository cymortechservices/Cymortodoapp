import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { Activity, AuthToken, DailyReflection, DeviceSession, FocusSession, Goal, Habit, HabitCompletion, NotificationSubscription, Reminder, SharedSchedule, User, UserSettings } from '../db/models.js';
import { asyncHandler, HttpError, parse } from '../lib/http.js';
import { checkPassword, hashPassword, randomToken, requireAuth, sha256, signAccess, uid } from '../lib/auth.js';
import { sendMail } from '../lib/mailer.js';
import { isValidTimezone } from '../core/time.js';
import { jobsCol, logsCol } from '../db/connection.js';

const password = z.string().min(8, 'at least 8 characters').max(200);
const tz = z.string().refine(isValidTimezone, 'invalid IANA timezone');

async function issueSession(userId: string, userAgent?: string) {
  const refresh = randomToken(48);
  const expiresAt = new Date(Date.now() + config.REFRESH_TTL_DAYS * 86_400_000);
  const s = await DeviceSession.create({ userId, refreshHash: sha256(refresh), userAgent, expiresAt });
  return { accessToken: signAccess(userId, String(s._id)), refreshToken: refresh, expiresInSec: config.ACCESS_TTL_MIN * 60 };
}

async function oneTimeToken(userId: string, purpose: 'verify' | 'reset', ttlMs: number) {
  const raw = randomToken(32);
  await AuthToken.create({ userId, purpose, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + ttlMs) });
  return raw;
}

const publicUser = (u: { _id: unknown; email?: string | null; name: string; timezone: string; emailVerified: boolean; guest?: boolean | null; passwordHash?: string | null }) => ({
  id: String(u._id), email: u.email ?? null, name: u.name, timezone: u.timezone, emailVerified: u.emailVerified, guest: !!u.guest, hasPassword: !!u.passwordHash,
});

// 20 chars from a 31-symbol alphabet (no 0/O/1/I/L) = ~99 bits. Shown once; only its hash is stored.
const RC_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function newRecoveryCode(): string {
  const bytes = randomBytes(20);
  const chars = Array.from(bytes, (b) => RC_ALPHABET[b % RC_ALPHABET.length]).join('');
  return chars.match(/.{5}/g)!.join('-');
}
export const normalizeRecovery = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '');
const recoveryHash = (c: string) => sha256(normalizeRecovery(c));

export function authRouter(): Router {
  const r = Router();
  const limiter = rateLimit({ windowMs: 15 * 60_000, limit: config.NODE_ENV === 'test' ? 10_000 : 30, standardHeaders: true, legacyHeaders: false });

  /** No-email start: just a username. The device keeps a session; the recovery code (shown once) restores it elsewhere. */
  r.post('/guest', limiter, asyncHandler(async (req, res) => {
    const b = parse(z.object({ name: z.string().trim().min(2, 'at least 2 characters').max(30), timezone: tz.default(config.DEFAULT_TIMEZONE) }), req.body);
    const recoveryCode = newRecoveryCode();
    const user = await User.create({ name: b.name, timezone: b.timezone, guest: true, recoveryHash: recoveryHash(recoveryCode) });
    await UserSettings.create({ userId: user._id });
    const tokens = await issueSession(String(user._id), req.get('user-agent') ?? undefined);
    res.status(201).json({ user: publicUser(user), ...tokens, recoveryCode });
  }));

  r.post('/recover', limiter, asyncHandler(async (req, res) => {
    const { recoveryCode } = parse(z.object({ recoveryCode: z.string().min(10).max(40) }), req.body);
    const user = await User.findOne({ recoveryHash: recoveryHash(recoveryCode) });
    if (!user) throw new HttpError(401, 'That recovery code is not valid', 'bad_recovery');
    res.json({ user: publicUser(user), ...(await issueSession(String(user._id), req.get('user-agent') ?? undefined)) });
  }));

  r.post('/register', limiter, asyncHandler(async (req, res) => {
    const b = parse(z.object({ email: z.string().email(), password, name: z.string().min(1).max(80), timezone: tz.default(config.DEFAULT_TIMEZONE) }), req.body);
    if (await User.exists({ email: b.email.toLowerCase() })) throw new HttpError(409, 'An account with this email already exists', 'email_taken');
    const user = await User.create({ email: b.email, passwordHash: await hashPassword(b.password), name: b.name, timezone: b.timezone });
    await UserSettings.create({ userId: user._id });
    const token = await oneTimeToken(String(user._id), 'verify', 48 * 3_600_000);
    const link = `${config.FRONTEND_URL}/verify-email?token=${token}`;
    const mail = await sendMail(b.email, 'Verify your CYMOR TO-DO email', `Welcome to CYMOR TO-DO.\nVerify your email: ${link}\n`);
    const tokens = await issueSession(String(user._id), req.get('user-agent') ?? undefined);
    res.status(201).json({ user: publicUser(user), ...tokens, verificationEmail: mail, ...(config.NODE_ENV !== 'production' ? { devVerifyToken: token } : {}) });
  }));

  r.post('/login', limiter, asyncHandler(async (req, res) => {
    const b = parse(z.object({ email: z.string().email(), password: z.string().min(1) }), req.body);
    const user = await User.findOne({ email: b.email.toLowerCase() });
    // Same message for unknown email and wrong password (no account enumeration).
    if (!user || !user.passwordHash || !(await checkPassword(b.password, user.passwordHash))) throw new HttpError(401, 'Invalid email or password', 'bad_credentials');
    res.json({ user: publicUser(user), ...(await issueSession(String(user._id), req.get('user-agent') ?? undefined)) });
  }));

  /** Refresh-token rotation: the old token is revoked on use; reuse of a revoked token revokes the family. */
  r.post('/refresh', asyncHandler(async (req, res) => {
    const { refreshToken } = parse(z.object({ refreshToken: z.string().min(10) }), req.body);
    const s = await DeviceSession.findOne({ refreshHash: sha256(refreshToken) });
    if (!s) throw new HttpError(401, 'Invalid refresh token', 'bad_refresh');
    if (s.revoked) {
      await DeviceSession.updateMany({ userId: s.userId }, { $set: { revoked: true } });
      throw new HttpError(401, 'Refresh token reuse detected; all sessions revoked', 'refresh_reuse');
    }
    if (s.expiresAt.getTime() < Date.now()) throw new HttpError(401, 'Refresh token expired', 'bad_refresh');
    s.revoked = true;
    await s.save();
    res.json(await issueSession(String(s.userId), s.userAgent ?? undefined));
  }));

  r.post('/logout', asyncHandler(async (req, res) => {
    const { refreshToken } = parse(z.object({ refreshToken: z.string().optional() }), req.body ?? {});
    if (refreshToken) await DeviceSession.updateOne({ refreshHash: sha256(refreshToken) }, { $set: { revoked: true } });
    res.json({ ok: true });
  }));

  r.post('/verify-email', asyncHandler(async (req, res) => {
    const { token } = parse(z.object({ token: z.string().min(10) }), req.body);
    const t = await AuthToken.findOne({ tokenHash: sha256(token), purpose: 'verify', used: false });
    if (!t || t.expiresAt.getTime() < Date.now()) throw new HttpError(400, 'Invalid or expired verification link', 'bad_token');
    t.used = true;
    await t.save();
    await User.updateOne({ _id: t.userId }, { $set: { emailVerified: true } });
    res.json({ ok: true });
  }));

  r.post('/request-reset', limiter, asyncHandler(async (req, res) => {
    const { email } = parse(z.object({ email: z.string().email() }), req.body);
    const user = await User.findOne({ email: email.toLowerCase() });
    let devToken: string | undefined;
    if (user?.email) {
      devToken = await oneTimeToken(String(user._id), 'reset', 60 * 60_000);
      await sendMail(user.email, 'Reset your CYMOR TO-DO password', `Reset link (valid 1 hour): ${config.FRONTEND_URL}/reset-password?token=${devToken}\n`);
    }
    // Always the same response so the endpoint cannot be used to discover accounts.
    res.json({ ok: true, ...(config.NODE_ENV !== 'production' && devToken ? { devResetToken: devToken } : {}) });
  }));

  r.post('/reset-password', limiter, asyncHandler(async (req, res) => {
    const b = parse(z.object({ token: z.string().min(10), password }), req.body);
    const t = await AuthToken.findOne({ tokenHash: sha256(b.token), purpose: 'reset', used: false });
    if (!t || t.expiresAt.getTime() < Date.now()) throw new HttpError(400, 'Invalid or expired reset link', 'bad_token');
    t.used = true;
    await t.save();
    await User.updateOne({ _id: t.userId }, { $set: { passwordHash: await hashPassword(b.password) } });
    await DeviceSession.updateMany({ userId: t.userId }, { $set: { revoked: true } }); // sign out everywhere
    res.json({ ok: true });
  }));

  // ---- authenticated ----
  r.get('/me', requireAuth, asyncHandler(async (req, res) => {
    const u = await User.findById(uid(req));
    if (!u) throw new HttpError(401, 'Account no longer exists', 'unauthenticated');
    res.json({ user: publicUser(u) });
  }));

  r.patch('/me', requireAuth, asyncHandler(async (req, res) => {
    const b = parse(z.object({ name: z.string().min(1).max(80).optional(), timezone: tz.optional() }), req.body);
    const u = await User.findByIdAndUpdate(uid(req), { $set: b }, { returnDocument: 'after' });
    res.json({ user: publicUser(u!) });
  }));

  /** Replaces the recovery code (the old one stops working). Shown once. */
  r.post('/recovery-code', requireAuth, limiter, asyncHandler(async (req, res) => {
    const code = newRecoveryCode();
    await User.updateOne({ _id: uid(req) }, { $set: { recoveryHash: recoveryHash(code) } });
    res.json({ recoveryCode: code });
  }));

  /** Optional: turn a guest account into an email+password account (keeps all data). */
  r.post('/upgrade', requireAuth, limiter, asyncHandler(async (req, res) => {
    const b = parse(z.object({ email: z.string().email(), password }), req.body);
    const u = await User.findById(uid(req));
    if (!u) throw new HttpError(401, 'Account no longer exists', 'unauthenticated');
    if (u.passwordHash) throw new HttpError(409, 'This account already has a password', 'conflict');
    if (await User.exists({ email: b.email.toLowerCase() })) throw new HttpError(409, 'An account with this email already exists', 'email_taken');
    u.email = b.email.toLowerCase();
    u.passwordHash = await hashPassword(b.password);
    u.emailVerified = false;
    await u.save();
    const token = await oneTimeToken(String(u._id), 'verify', 48 * 3_600_000);
    const mail = await sendMail(u.email, 'Verify your CYMOR TO-DO email', `Verify your email: ${config.FRONTEND_URL}/verify-email?token=${token}\n`);
    res.json({ user: publicUser(u), verificationEmail: mail, ...(config.NODE_ENV !== 'production' ? { devVerifyToken: token } : {}) });
  }));

  r.post('/change-password', requireAuth, limiter, asyncHandler(async (req, res) => {
    const b = parse(z.object({ currentPassword: z.string(), newPassword: password }), req.body);
    const u = await User.findById(uid(req));
    if (!u?.passwordHash) throw new HttpError(400, 'This account has no password yet. Add an email and password first.', 'no_password');
    if (!(await checkPassword(b.currentPassword, u.passwordHash))) throw new HttpError(401, 'Current password is incorrect', 'bad_credentials');
    u.passwordHash = await hashPassword(b.newPassword);
    await u.save();
    await DeviceSession.updateMany({ userId: u._id, _id: { $ne: req.user!.sid } }, { $set: { revoked: true } });
    res.json({ ok: true });
  }));

  r.get('/sessions', requireAuth, asyncHandler(async (req, res) => {
    const rows = await DeviceSession.find({ userId: uid(req), revoked: false, expiresAt: { $gt: new Date() } }).sort({ lastUsedAt: -1 }).lean();
    res.json({ sessions: rows.map((s) => ({ id: String(s._id), userAgent: s.userAgent, createdAt: s.createdAt, current: String(s._id) === req.user!.sid })) });
  }));
  r.delete('/sessions/:id', requireAuth, asyncHandler(async (req, res) => {
    await DeviceSession.updateOne({ _id: req.params.id, userId: uid(req) }, { $set: { revoked: true } });
    res.json({ ok: true });
  }));
  r.post('/logout-all', requireAuth, asyncHandler(async (req, res) => {
    await DeviceSession.updateMany({ userId: uid(req) }, { $set: { revoked: true } });
    res.json({ ok: true });
  }));

  /** Full data export (GDPR-style). Passwords/tokens are never included. */
  r.get('/export', requireAuth, asyncHandler(async (req, res) => {
    const userId = uid(req);
    const [user, settings, activities, reminders, habits, completions, goals, focus, reflections, subs] = await Promise.all([
      User.findById(userId).lean(), UserSettings.findOne({ userId }).lean(), Activity.find({ userId }).lean(), Reminder.find({ userId }).lean(),
      Habit.find({ userId }).lean(), HabitCompletion.find({ userId }).lean(), Goal.find({ userId }).lean(), FocusSession.find({ userId }).lean(),
      DailyReflection.find({ userId }).lean(), NotificationSubscription.find({ userId }).lean(),
    ]);
    res.setHeader('Content-Disposition', 'attachment; filename="cymor-todo-export.json"');
    res.json({
      exportedAt: new Date().toISOString(),
      user: user && { email: user.email ?? null, name: user.name, timezone: user.timezone, createdAt: user.createdAt },
      settings, activities, reminders, habits, habitCompletions: completions, goals, focusSessions: focus, reflections,
      devices: subs.map((s) => ({ userAgent: s.userAgent, active: s.active, createdAt: s.createdAt })),
    });
  }));

  /** Permanent account deletion; requires the password. */
  r.delete('/me', requireAuth, limiter, asyncHandler(async (req, res) => {
    const { password: pw, confirmName } = parse(z.object({ password: z.string().optional(), confirmName: z.string().optional() }), req.body);
    const userId = uid(req);
    const u = await User.findById(userId);
    if (!u) throw new HttpError(401, 'Account no longer exists', 'unauthenticated');
    if (u.passwordHash) {
      if (!pw || !(await checkPassword(pw, u.passwordHash))) throw new HttpError(401, 'Password is incorrect', 'bad_credentials');
    } else if ((confirmName ?? '').trim() !== u.name) {
      throw new HttpError(400, 'Type your username exactly to confirm deletion', 'confirm_required');
    }
    await Promise.all([
      Activity, Reminder, Habit, HabitCompletion, Goal, FocusSession, DailyReflection, NotificationSubscription, DeviceSession, AuthToken, SharedSchedule, UserSettings,
    ].map((m) => (m as unknown as { deleteMany(f: object): Promise<unknown> }).deleteMany({ userId })));
    await jobsCol().deleteMany({ userId } as never);
    await logsCol().deleteMany({ userId });
    await User.deleteOne({ _id: userId });
    res.json({ ok: true });
  }));

  return r;
}

