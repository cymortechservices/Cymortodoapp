import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { z } from 'zod';
import { Activity, SharedSchedule, User } from '../db/models.js';
import { asyncHandler, HttpError, oid, parse } from '../lib/http.js';
import { randomToken, requireAuth, sha256, uid } from '../lib/auth.js';
import { rangeToUtc, ymdSchema } from '../lib/range.js';
import { formatLocal, localDate, ymd, zonedToUtc } from '../core/time.js';
import { previewFromCsv, previewFromRows, type ImportPreview } from '../core/timetable.js';
import { planActivity, userDefaultNotify } from '../services/planner.js';
import { config } from '../config.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.UPLOAD_LIMIT_MB * 1024 * 1024, files: 1 } });

interface Row { title: string; category?: string; location?: string; startUtc: number; endUtc: number; cancelled?: boolean | null; description?: string | null }

async function loadRange(userId: string, from: string, to: string) {
  const u = await User.findById(userId).lean();
  if (!u) throw new HttpError(401, 'Account no longer exists', 'unauthenticated');
  const [a, b] = rangeToUtc(from, to, u.timezone);
  const rows = (await Activity.find({ userId, startUtc: { $gte: a, $lt: b }, cancelled: { $ne: true } }).sort({ startUtc: 1 }).lean()) as unknown as Row[];
  return { tz: u.timezone, name: u.name, rows };
}

const csvCell = (v: unknown) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralise spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function toCsv(rows: Row[], tz: string): string {
  const head = ['Date', 'Start', 'End', 'Title', 'Category', 'Location', 'Description'];
  const lines = rows.map((r) => {
    const s = formatLocal(r.startUtc, tz).split(' ');
    const e = formatLocal(r.endUtc, tz).split(' ');
    return [s[0], s[1], e[1], r.title, r.category ?? '', r.location ?? '', r.description ?? ''].map(csvCell).join(',');
  });
  return [head.join(','), ...lines].join('\r\n') + '\r\n';
}

const icsEsc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsDate = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
export function toIcs(rows: (Row & { _id?: unknown })[], name: string): string {
  const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CYMOR TO-DO//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${icsEsc(name)}`];
  for (const r of rows) {
    out.push('BEGIN:VEVENT', `UID:${String(r._id ?? r.startUtc)}@cymor-todo`, `DTSTAMP:${icsDate(Date.now())}`, `DTSTART:${icsDate(r.startUtc)}`, `DTEND:${icsDate(r.endUtc)}`, `SUMMARY:${icsEsc(r.title)}`);
    if (r.location) out.push(`LOCATION:${icsEsc(r.location)}`);
    if (r.description) out.push(`DESCRIPTION:${icsEsc(r.description)}`);
    out.push('END:VEVENT');
  }
  out.push('END:VCALENDAR');
  return out.join('\r\n') + '\r\n';
}

function toPdf(rows: Row[], tz: string, title: string, subtitle: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(20).text('CYMOR TO-DO', { continued: false }).fontSize(12).fillColor('#555').text(`${title} · ${subtitle} · ${tz}`).moveDown();
    let day = '';
    for (const r of rows) {
      const [d, st] = formatLocal(r.startUtc, tz).split(' ');
      const et = formatLocal(r.endUtc, tz).split(' ')[1];
      if (d !== day) {
        day = d!;
        if (doc.y > 700) doc.addPage();
        doc.moveDown(0.5).fontSize(13).fillColor('#000').text(d!);
      }
      if (doc.y > 760) doc.addPage();
      doc.fontSize(11).fillColor('#222').text(`${st}–${et}   ${r.title}${r.location ? `  (${r.location})` : ''}`);
    }
    if (!rows.length) doc.fontSize(11).fillColor('#222').text('No activities in this range.');
    doc.end();
  });
}

async function xlsxRows(buf: Buffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as never);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    for (let c = 1; c <= row.cellCount; c++) {
      const v = row.getCell(c).value as unknown;
      if (v instanceof Date) {
        cells.push(v.getUTCFullYear() < 1901 ? `${String(v.getUTCHours()).padStart(2, '0')}:${String(v.getUTCMinutes()).padStart(2, '0')}` : ymd(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate()));
      } else if (v && typeof v === 'object' && 'result' in (v as object)) cells.push(String((v as { result: unknown }).result ?? ''));
      else if (v && typeof v === 'object' && 'text' in (v as object)) cells.push(String((v as { text: unknown }).text));
      else cells.push(v === null || v === undefined ? '' : String(v));
    }
    rows.push(cells);
  });
  return rows;
}


export function dataRouter(): Router {
  const r = Router();

  // ---- public read-only shared schedule: unguessable token, revocable, optional expiry ----
  const loadShare = async (token: string) => {
    const s = await SharedSchedule.findOne({ tokenHash: sha256(token) }).lean();
    if (!s || s.revoked || (s.expiresAt && s.expiresAt.getTime() < Date.now())) throw new HttpError(404, 'This shared schedule is not available', 'not_found');
    return s;
  };
  r.get('/public/shared/:token/calendar.ics', asyncHandler(async (req, res) => {
    const s = await loadShare(String(req.params.token));
    const { rows } = await loadRange(String(s.userId), s.from, s.to);
    res.setHeader('Cache-Control', 'no-store');
    res.type('text/calendar').attachment('cymor-schedule.ics').send(toIcs(rows.map((x) => ({ ...x, description: undefined })) as never, s.title));
  }));
  r.get('/public/shared/:token', asyncHandler(async (req, res) => {
    const s = await loadShare(String(req.params.token));
    const { tz, name, rows } = await loadRange(String(s.userId), s.from, s.to);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    res.json({
      title: s.title, owner: name.split(' ')[0], timezone: tz, from: s.from, to: s.to,
      // Only schedule basics: no notes, check-in data, analytics or contact info.
      activities: rows.map((x) => ({ title: x.title, category: x.category, color: (x as { color?: string }).color, location: x.location, startUtc: x.startUtc, endUtc: x.endUtc, localDate: localDate(x.startUtc, tz) })),
    });
  }));

  r.use(requireAuth);

  r.post('/import/preview', upload.single('file'), asyncHandler(async (req, res) => {
    let preview: ImportPreview;
    if (req.file) {
      const name = req.file.originalname.toLowerCase();
      if (name.endsWith('.csv') || name.endsWith('.txt') || req.file.mimetype.startsWith('text/')) preview = previewFromCsv(req.file.buffer.toString('utf8'));
      else if (name.endsWith('.xlsx')) preview = previewFromRows(await xlsxRows(req.file.buffer));
      else throw new HttpError(415, 'Supported: .csv, .txt, .xlsx. (PDF and image/OCR import are not available yet; export your timetable as CSV/XLSX.)', 'unsupported_type');
    } else {
      const { text } = parse(z.object({ text: z.string().min(1).max(500_000) }), req.body);
      preview = previewFromCsv(text);
    }
    res.json({ preview });
  }));

  /** Create activities from a USER-REVIEWED preview. Rows without a date use defaultDate. */
  r.post('/import/confirm', asyncHandler(async (req, res) => {
    const b = parse(z.object({
      defaultDate: ymdSchema.optional(),
      category: z.string().max(50).default('timetable'),
      rows: z.array(z.object({ title: z.string().min(1).max(200), date: ymdSchema.optional(), start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/), description: z.string().max(1000).optional() })).min(1).max(500),
    }), req.body);
    const u = await User.findById(uid(req)).lean();
    if (!u) throw new HttpError(401, 'Account no longer exists', 'unauthenticated');
    const notify = await userDefaultNotify(uid(req));
    const problems: string[] = [];
    const docs: Record<string, unknown>[] = [];
    b.rows.forEach((row, i) => {
      const date = row.date ?? b.defaultDate;
      if (!date) return void problems.push(`Row ${i + 1}: no date (set defaultDate)`);
      const startUtc = zonedToUtc(date, row.start, u.timezone);
      const endUtc = zonedToUtc(date, row.end, u.timezone);
      if (endUtc <= startUtc) return void problems.push(`Row ${i + 1}: end must be after start`);
      docs.push({ userId: uid(req), title: row.title, description: row.description ?? '', category: b.category, startUtc, endUtc, notify });
    });
    if (problems.length) throw new HttpError(400, problems.join('; '), 'bad_rows');
    const created = await Activity.insertMany(docs);
    let jobs = 0;
    for (const a of created) jobs += await planActivity(a as never);
    res.status(201).json({ created: created.length, jobsPlanned: jobs });
  }));

  const rangeQ = z.object({ from: ymdSchema, to: ymdSchema });

  r.get('/export/schedule.csv', asyncHandler(async (req, res) => {
    const q = parse(rangeQ, req.query);
    const { tz, rows } = await loadRange(uid(req), q.from, q.to);
    res.type('text/csv').attachment(`cymor-schedule-${q.from}_${q.to}.csv`).send(toCsv(rows, tz));
  }));
  r.get('/export/schedule.ics', asyncHandler(async (req, res) => {
    const q = parse(rangeQ, req.query);
    const { rows } = await loadRange(uid(req), q.from, q.to);
    res.type('text/calendar').attachment(`cymor-schedule-${q.from}_${q.to}.ics`).send(toIcs(rows as never, 'CYMOR TO-DO'));
  }));
  r.get('/export/schedule.pdf', asyncHandler(async (req, res) => {
    const q = parse(rangeQ, req.query);
    const { tz, name, rows } = await loadRange(uid(req), q.from, q.to);
    res.type('application/pdf').attachment(`cymor-schedule-${q.from}_${q.to}.pdf`).send(await toPdf(rows, tz, name, `${q.from} to ${q.to}`));
  }));

  // ---- share links ----
  r.get('/shares', asyncHandler(async (req, res) => {
    const rows = await SharedSchedule.find({ userId: uid(req) }).sort({ createdAt: -1 }).lean();
    res.json({ shares: rows.map((s) => ({ id: String(s._id), title: s.title, from: s.from, to: s.to, revoked: s.revoked, expiresAt: s.expiresAt, createdAt: s.createdAt })) });
  }));
  r.post('/shares', asyncHandler(async (req, res) => {
    const b = parse(rangeQ.extend({ title: z.string().max(100).default('My schedule'), expiresInDays: z.number().int().min(1).max(365).optional() }), req.body);
    if (b.to < b.from) throw new HttpError(400, '"to" must not be before "from"', 'bad_range');
    const token = randomToken(32);
    const s = await SharedSchedule.create({
      userId: uid(req), tokenHash: sha256(token), title: b.title, from: b.from, to: b.to,
      expiresAt: b.expiresInDays ? new Date(Date.now() + b.expiresInDays * 86_400_000) : undefined,
    });
    // The raw token is shown ONCE; only its hash is stored.
    res.status(201).json({ id: String(s._id), token, url: `${config.FRONTEND_URL}/shared/${token}` });
  }));
  r.delete('/shares/:id', asyncHandler(async (req, res) => {
    if (!oid.test(String(req.params.id))) throw new HttpError(404, 'Not found', 'not_found');
    await SharedSchedule.updateOne({ _id: req.params.id, userId: uid(req) }, { $set: { revoked: true } });
    res.json({ ok: true });
  }));

  return r;
}
