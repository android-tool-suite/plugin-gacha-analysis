import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

(0, eval)(readFileSync(new URL('../workers/summary.js', import.meta.url), 'utf8'));
const values = {
  'genshin-records': {accounts: [{uid: '1'}], records: [{id: '1', extra: {nested: true}}, {id: '2'}]},
  'starrail-records': {accounts: [{uid: '2'}], records: [{id: '3'}]}
};
const bytes = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Buffer.from(JSON.stringify(value))]));
const ats = {
  decodeBase64: value => Uint8Array.from(Buffer.from(value, 'base64')),
  call: async (method, payload) => {
    if (method === 'storage.dataset.openRead') {
      return {found: true, handle: payload.datasetId, size: bytes[payload.datasetId].length};
    }
    if (method === 'storage.dataset.read') {
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
