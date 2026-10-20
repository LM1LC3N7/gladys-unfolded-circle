import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config.js';
import { sanitize } from '../src/store.js';

const SALT = '0123456789abcdef0123456789abcdef';

test('defaults and normalization', () => {
  const c = normalizeConfig({ host: '192.168.1.20', api_key: ' key-1 ' }, SALT);
  assert.equal(c.baseUrl, 'http://192.168.1.20/api/');
  assert.equal(c.apiKey, 'key-1');
  assert.equal(c.ready, true);
  assert.equal(c.pollMs, 60_000);
  assert.equal(c.language, 'fr');
  assert.match(c.fingerprint, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify({ ...c, apiKey: undefined }).includes('key-1'));
  assert.equal(normalizeConfig({ poll_interval: '5' }).pollMs, 60_000);
  assert.equal(normalizeConfig({ poll_interval: '300' }).pollMs, 300_000);
  assert.equal(normalizeConfig({ language: 'en' }).language, 'en');
});

test('a key or host that cannot be right is treated as missing', () => {
  assert.equal(normalizeConfig({ host: '192.168.1.20', api_key: 'a\nb' }).ready, false);
  assert.equal(normalizeConfig({ host: '192.168.1.20', api_key: 'x'.repeat(600) }).ready, false);
  const bad = normalizeConfig({ host: 'http://remote/path', api_key: 'k' });
  assert.equal(bad.ready, false);
  assert.equal(bad.invalidHost, true);
  assert.equal(normalizeConfig({}).invalidHost, false);
});

test('the digest depends on the address and the key', () => {
  const a = normalizeConfig({ host: 'a', api_key: 'k1' }, SALT).fingerprint;
  assert.notEqual(a, normalizeConfig({ host: 'a', api_key: 'k2' }, SALT).fingerprint);
  assert.notEqual(a, normalizeConfig({ host: 'b', api_key: 'k1' }, SALT).fingerprint);
  assert.equal(a, normalizeConfig({ host: 'http://a/', api_key: 'k1' }, SALT).fingerprint);
});

test('saved data is checked field by field and bounded', () => {
  const now = 1_000_000_000_000;
  const data = sanitize(
    JSON.parse(
      JSON.stringify({
        remote: { id: 'SN1', serial: 'SN1', mac: 'a0:b1:c2:d3:e4:f5', name: 'R', model: 'R' },
        activities: {
          a1: { id: 'a1', name: 'One' },
          __proto__: { id: '__proto__', name: 'x' },
          a2: { id: 'other', name: 'Mismatch' },
        },
        block: { fingerprint: 'f'.repeat(64), at: now + 5, attempts: 2, nextAt: now + 1e12 },
        pause: { until: now + 1e12 },
        salt: SALT,
        apiKey: 'never kept',
      }),
    ),
    now,
  );
  assert.deepEqual(Object.keys(data.activities), ['a1']);
  assert.equal(Object.getPrototypeOf(data.activities), null);
  assert.equal(data.block.at, now);
  assert.equal(data.block.nextAt, now + 24 * 3_600_000);
  assert.equal(data.pause.until, now + 6 * 3_600_000);
  assert.equal(data.apiKey, undefined);
  assert.equal(sanitize({ pause: { until: now - 1 } }, now).pause, null);
  assert.equal(sanitize('junk', now).remote, null);
});
