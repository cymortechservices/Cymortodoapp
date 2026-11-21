import test from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test';
const { nativeNeedsServerPush } = await import('../src/services/push.js');
const { newRecoveryCode, normalizeRecovery } = await import('../src/routes/auth.js');

test('nativeNeedsServerPush: the server pushes only what the phone has not scheduled itself', () => {
  const dev = { localUntil: 10_000, syncedAt: 5_000 };
  assert.equal(nativeNeedsServerPush({ fireAt: 8_000, createdAt: 4_000, kind: 'start' }, dev), false, 'inside local horizon, known at last sync => phone fires it');
  assert.equal(nativeNeedsServerPush({ fireAt: 12_000, createdAt: 4_000, kind: 'start' }, dev), true, 'beyond the local horizon');
  assert.equal(nativeNeedsServerPush({ fireAt: 8_000, createdAt: 6_000, kind: 'start' }, dev), true, 'created after the last sync (e.g. planned on the web)');
  assert.equal(nativeNeedsServerPush({ fireAt: 8_000, createdAt: 4_000, kind: 'start' }, { localUntil: 0, syncedAt: 0 }), true, 'never synced => push everything');
  assert.equal(nativeNeedsServerPush({ fireAt: 100, createdAt: 100, kind: 'reminder' }, dev), true, 'immediate/test sends always go out');
});

test('recovery codes: format, entropy alphabet, normalisation', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const c = newRecoveryCode();
    assert.match(c, /^[A-HJ-NP-Z2-9]{5}(-[A-HJ-NP-Z2-9]{5}){3}$/);
    seen.add(c);
  }
  assert.equal(seen.size, 200, 'no collisions');
  const c = newRecoveryCode();
  assert.equal(normalizeRecovery(c.toLowerCase().replace(/-/g, ' ')), normalizeRecovery(c), 'case/spacing/dashes do not matter');
});
