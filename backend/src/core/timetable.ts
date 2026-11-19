/**
 * Timetable import (CSV/text rows). Every extracted row is a DRAFT: the result is
 * always `needsReview: true` and nothing here activates a schedule. The same
 * normaliser is meant to be fed by XLSX/PDF/OCR text extractors later.
 */

export interface ExtractedRow {
  title: string;
  date?: string; // YYYY-MM-DD
  start?: string; // HH:mm
  end?: string; // HH:mm
  description?: string;
  warnings: string[];
  sourceRow: number;
}

export interface ImportPreview {
  rows: ExtractedRow[];
  columns: { title?: string; date?: string; start?: string; end?: string; time?: string; description?: string };
  needsReview: true;
  errors: string[];
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === ';' || c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows.map((r) => r.map((x) => x.trim()));
}

const SYN: Record<string, string[]> = {
  title: ['activity', 'title', 'task', 'subject', 'event', 'name', 'course', 'unit'],
  date: ['date', 'day'],
  start: ['start', 'from', 'begin', 'start time'],
  end: ['end', 'to', 'finish', 'end time', 'until'],
  time: ['time', 'time slot', 'timeslot', 'period', 'hours'],
  description: ['description', 'notes', 'details', 'note', 'venue', 'location'],
};

export function detectColumns(header: string[]): ImportPreview['columns'] {
  const cols: ImportPreview['columns'] = {};
  header.forEach((h, idx) => {
    const key = h.toLowerCase().trim();
    for (const [field, names] of Object.entries(SYN)) {
      if (names.includes(key) && (cols as Record<string, string>)[field] === undefined) {
        (cols as Record<string, string>)[field] = String(idx);
      }
    }
  });
  return cols;
}

/** "8:00 AM", "08:00", "8am", "8.30pm", "1400" -> "HH:mm" or null. */
export function normalizeTime(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/\./g, ':');
  const m = /^(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (min > 59) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    if (m[3] === 'pm' && h !== 12) h += 12;
    if (m[3] === 'am' && h === 12) h = 0;
  }
  if (h > 23) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export function splitRange(raw: string): [string, string] | null {
  const parts = raw.split(/\s*(?:-|–|—|to)\s*/i);
  return parts.length === 2 && parts[0] && parts[1] ? [parts[0], parts[1]] : null;
}

/** ISO (YYYY-MM-DD) and day-first (DD/MM/YYYY, DD-MM-YYYY) dates. Day-first is the documented default. */
export function normalizeDate(raw: string): string | null {
  const s = raw.trim();
  let y: number, mo: number, d: number;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) { d = +m[1]; mo = +m[2]; y = +m[3]; }
  else return null;
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function previewFromRows(rows: string[][]): ImportPreview {
  const errors: string[] = [];
  if (rows.length < 2) return { rows: [], columns: {}, needsReview: true, errors: ['File has no data rows'] };
  const columns = detectColumns(rows[0]);
  const idx = (k: keyof ImportPreview['columns']) => (columns[k] === undefined ? -1 : Number(columns[k]));
  if (idx('title') < 0) errors.push('Could not find an activity/title column');
  if (idx('start') < 0 && idx('time') < 0) errors.push('Could not find a start time or time column');

  const out: ExtractedRow[] = [];
  rows.slice(1).forEach((r, n) => {
    const warnings: string[] = [];
    const get = (k: keyof ImportPreview['columns']) => (idx(k) >= 0 ? (r[idx(k)] ?? '') : '');
    const row: ExtractedRow = { title: get('title'), warnings, sourceRow: n + 2 };
    if (!row.title) warnings.push('Missing title');

    const d = get('date');
    if (d) {
      const nd = normalizeDate(d);
      if (nd) row.date = nd; else warnings.push(`Unrecognised date "${d}"`);
    }

    let startRaw = get('start'), endRaw = get('end');
    const t = get('time');
    if (t && !startRaw) {
      const range = splitRange(t);
      if (range) [startRaw, endRaw] = range; else startRaw = t;
    }
    if (startRaw) {
      const s = normalizeTime(startRaw);
      if (s) row.start = s; else warnings.push(`Unrecognised start time "${startRaw}"`);
    } else warnings.push('Missing start time');
    if (endRaw) {
      const e = normalizeTime(endRaw);
      if (e) row.end = e; else warnings.push(`Unrecognised end time "${endRaw}"`);
    }
    if (row.start && row.end && row.end <= row.start) warnings.push('End time is not after start time');
    const desc = get('description');
    if (desc) row.description = desc;
    out.push(row);
  });
  return { rows: out, columns, needsReview: true, errors };
}

export function previewFromCsv(text: string): ImportPreview {
  return previewFromRows(parseCsv(text));
}
