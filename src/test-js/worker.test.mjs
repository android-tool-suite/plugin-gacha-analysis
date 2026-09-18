import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

(0, eval)(readFileSync(new URL('../workers/summary.js', import.meta.url), 'utf8'));
const values = {
  'genshin-records': {accounts: [{uid: '1'}], records: [{id: '1', extra: {nested: true}}, {id: '2'}]},
  'starrail-records': {accounts: [{uid: '2'}], records: [{id: '3'}]}
};
const bytes = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Buffer.from(JSON.stringify(value))]));
const cache = new Map();
let reads = 0;
const ats = {
  decodeBase64: value => Uint8Array.from(Buffer.from(value, 'base64')),
  call: async (method, payload) => {
    if (method === 'storage.kv.get') return {found: cache.has(payload.key), value: cache.get(payload.key)};
    if (method === 'storage.kv.set') { cache.set(payload.key,payload.value); return {stored:true}; }
    if (method === 'storage.dataset.openRead') {
      return {found: true, handle: payload.datasetId, size: bytes[payload.datasetId].length, sha256:createHash('sha256').update(bytes[payload.datasetId]).digest('hex')};
    }
    if (method === 'storage.dataset.read') {
      reads++;
      const source = bytes[payload.handle];
      const part = source.subarray(payload.offset, payload.offset + 7);
      return {bytes: part.toString('base64'), eof: payload.offset + part.length >= source.length};
    }
    if (method === 'storage.dataset.abort') return {};
    throw new Error(method);
  }
};
const result = await globalThis.atsWorkerMain({kind: 'capability', method: 'gacha.summary.get'}, ats);
assert.equal(result.value, 3);
assert.equal(result.title, '2 个账号');
assert.equal(result.detail, '原神 2 · 星铁 1');
console.log('Streaming Gacha summary worker fixture: OK');

assert.ok(reads > 0, 'legacy data still uses the real streaming counter');
reads = 0;
assert.deepEqual(await globalThis.atsWorkerMain({kind:'capability',method:'gacha.summary.get'},ats), result);
assert.equal(reads, 0, 'unchanged records must reuse the digest-bound counts');
bytes['genshin-records'] = Buffer.from(JSON.stringify({accounts:[{uid:'1'}],records:[{id:'4'}]}));
const changed = await globalThis.atsWorkerMain({kind:'capability',method:'gacha.summary.get'},ats);
assert.equal(changed.value, 2, 'restoring/replacing records invalidates cached counts');
assert.ok(reads > 0);
cache.get('summary:genshin-records').records = -1;
reads=0;
assert.equal((await globalThis.atsWorkerMain({kind:'capability',method:'gacha.summary.get'},ats)).value,2);
assert.ok(reads > 0, 'invalid cached counts are recomputed');
