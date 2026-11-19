import test from 'node:test';
import assert from 'node:assert/strict';
import { previewFromCsv, normalizeTime, normalizeDate, parseCsv } from '../src/core/timetable.js';

test('normalizeTime handles 12h, 24h and loose formats', () => {
  assert.equal(normalizeTime('8:00 AM'), '08:00');
  assert.equal(normalizeTime('12:00 AM'), '00:00');
  assert.equal(normalizeTime('12:30 pm'), '12:30');
  assert.equal(normalizeTime('8pm'), '20:00');
  assert.equal(normalizeTime('8.30pm'), '20:30');
  assert.equal(normalizeTime('1400'), '14:00');
  assert.equal(normalizeTime('25:00'), null);
  assert.equal(normalizeTime('13pm'), null);
  assert.equal(normalizeTime('abc'), null);
});

test('normalizeDate: ISO and day-first, rejects impossible dates', () => {
  assert.equal(normalizeDate('2026-11-16'), '2026-11-16');
  assert.equal(normalizeDate('16/11/2026'), '2026-11-16');
  assert.equal(normalizeDate('31/02/2026'), null);
  assert.equal(normalizeDate('tomorrow'), null);
});

test('CSV with quoted commas, BOM and CRLF', () => {
  assert.deepEqual(parseCsv('﻿a,"b,c"\r\n1,2\r\n'), [['a', 'b,c'], ['1', '2']]);
});

test('import preview: columns detected, rows normalised, always needsReview', () => {
  const csv = 'Date,Time,Activity,Notes\n16/11/2026,8:00 AM - 10:00 AM,Programming,"Lab, room 4"\n16/11/2026,10:00-11:00,Study,\n';
  const p = previewFromCsv(csv);
  assert.equal(p.needsReview, true);
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.rows.map((r) => [r.title, r.date, r.start, r.end]), [
    ['Programming', '2026-11-16', '08:00', '10:00'],
    ['Study', '2026-11-16', '10:00', '11:00'],
  ]);
  assert.equal(p.rows[0].description, 'Lab, room 4');
});

test('bad rows produce warnings for the user to correct, not silent guesses', () => {
  const p = previewFromCsv('Activity,Start,End\n,9:00,8:00\nGym,nonsense,\n');
  assert.ok(p.rows[0].warnings.includes('Missing title'));
  assert.ok(p.rows[0].warnings.includes('End time is not after start time'));
  assert.ok(p.rows[1].warnings.some((w) => w.startsWith('Unrecognised start time')));
  assert.equal(p.rows[1].start, undefined);
});

test('missing required columns and empty files are reported', () => {
  assert.ok(previewFromCsv('Foo,Bar\n1,2').errors.length >= 1);
  assert.deepEqual(previewFromCsv('Activity,Start').errors, ['File has no data rows']);
});
