import nodemailer from 'nodemailer';
import { config } from '../config.js';

export const outbox: { to: string; subject: string; text: string }[] = []; // inspected by tests only

/**
 * Sends via SMTP when SMTP_URL is set. Otherwise the message is logged (and kept in `outbox`),
 * which is fine for development but means NO real e-mail is sent. Production needs SMTP_URL.
 */
export async function sendMail(to: string, subject: string, text: string): Promise<'sent' | 'logged'> {
  if (!config.SMTP_URL) {
    if (config.NODE_ENV === 'test') outbox.push({ to, subject, text });
    else console.log(`[mail:not-sent] to=${to} subject="${subject}"\n${text}`);
    return 'logged';
  }
  const t = nodemailer.createTransport(config.SMTP_URL);
  await t.sendMail({ from: config.MAIL_FROM, to, subject, text });
  return 'sent';
}
