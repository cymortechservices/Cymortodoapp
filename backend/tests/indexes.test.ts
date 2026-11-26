import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIndexesResilient } from '../src/db/connection.js';

const ATLAS = 'An existing index has the same name as the requested index. Requested index: { v: 2, unique: true, key: { email: 1 }, name: "email_1", sparse: true }, existing index: { v: 2, unique: true, key: { email: 1 }, name: "email_1", background: true }';

test('conflicting old index is dropped by name and creation retried', async () => {
  let calls = 0; const dropped: string[] = [];
  const mdl = { collection: { name: 'users', dropIndex: async (n: string) => { dropped.push(n); } },
    createIndexes: async () => { if (++calls === 1) throw Object.assign(new Error(ATLAS), { code: 86 }); } };
  await createIndexesResilient(mdl);
  assert.deepEqual(dropped, ['email_1']); assert.equal(calls, 2);
});
test('unrelated errors still throw', async () => {
  const mdl = { collection: { name: 'u', dropIndex: async () => undefined }, createIndexes: async () => { throw new Error('network down'); } };
  await assert.rejects(() => createIndexesResilient(mdl), /network down/);
});
