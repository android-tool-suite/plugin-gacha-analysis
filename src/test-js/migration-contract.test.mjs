import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const manifest = JSON.parse(read('../manifest.template.json')
  .replace('@VERSION_NAME@', '2.0.0')
  .replace('@VERSION_CODE@', '19')
  .replace('@MIN_HOST_VERSION_CODE@', '24'));
const migration = JSON.parse(read('../test/resources/legacy/migration-contract.json'));
const session = JSON.parse(read('../test/resources/legacy/mihoyo-session.json'));

assert.equal(manifest.formatVersion, 3);
assert.deepEqual(manifest.requires.plugins, []);
assert.equal(manifest.runtime.providers.length, 0);
assert.equal(manifest.runtime.ui[0].type, 'declarative');
assert.equal(manifest.datasets.length, 4);
assert.deepEqual(new Set(manifest.datasets.map(item => item.id)), new Set(migration.datasets.map(item => item.id)));
for (const expected of migration.datasets) {
  const actual = manifest.datasets.find(item => item.id === expected.id);
  assert.equal(actual.formatVersion, expected.formatVersion);
  assert.equal(actual.category, expected.category);
  assert.equal(actual.sensitive, expected.sensitive);
  assert.deepEqual(actual.dependsOn, []);
}
assert.equal(manifest.datasets.find(item => item.id === 'mihoyo-session').sensitive, true);
const logs = manifest.requires.capabilities.find(item => item.id === 'system.logs');
assert.equal(logs.optional, true);
assert.deepEqual(logs.scopes.terms, ['auth_appid=webview_gacha', 'authkey=']);
assert.equal(manifest.requires.capabilities.some(item => item.id.startsWith('gacha.auth')), false);
assert.match(session.session, /fake_fixture_only/);
assert.doesNotMatch(read('../test/resources/legacy/genshin-records.json'), /stoken|cookie|authkey/i);
assert.doesNotMatch(read('../test/resources/legacy/starrail-records.json'), /stoken|cookie|authkey/i);

console.log('Format v3 migration manifest and sensitive fixture contract: OK');
