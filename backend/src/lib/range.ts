import { z } from 'zod';
import { addDays, zonedToUtc } from '../core/time.js';
import { HttpError } from './http.js';

export const ymdSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
export const hhmmSchema = z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, 'expected HH:mm');

/** Inclusive local-date range -> [startUtc, endUtc). */
export function rangeToUtc(from: string, to: string, tz: string): [number, number] {
  if (to < from) throw new HttpError(400, '"to" must not be before "from"', 'bad_range');
  const a = zonedToUtc(from, '00:00', tz);
  const b = zonedToUtc(addDays(to, 1), '00:00', tz);
  if (b - a > 400 * 86_400_000) throw new HttpError(400, 'Range too large (max ~400 days)', 'bad_range');
  return [a, b];
}
