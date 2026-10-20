import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KINDS } from '../src/remote/errors.js';
import { httpRequest, retryAfterMs } from '../src/remote/http.js';
import { RemoteApi } from '../src/remote/api.js';

const failure = (code) => Object.assign(new TypeError('fetch failed'), { cause: { code } });

test('retryAfterMs reads seconds and dates', () => {
  assert.equal(retryAfterMs('120'), 120_000);
  assert.equal(retryAfterMs(new Date(61_000).toUTCString(), 1_000), 60_000);
  assert.equal(retryAfterMs('soon'), undefined);
  assert.equal(retryAfterMs(null), undefined);
});

test('network failures: unreachable (nothing sent) or no answer (maybe sent)', async () => {
  for (const code of ['ECONNREFUSED', 'EHOSTUNREACH', 'ENOTFOUND']) {
    await assert.rejects(
      httpRequest('http://r/api/x', {}, async () => {
        throw failure(code);
      }),
      (err) => err.kind === KINDS.UNREACHABLE,
    );
  }
  await assert.rejects(
    httpRequest('http://r/api/x', {}, async () => {
      throw failure('ECONNRESET');
    }),
    (err) => err.kind === KINDS.NO_ANSWER,
  );
  // A request that never ends is aborted at the timeout.
  await assert.rejects(
    httpRequest(
      'http://r/api/x',
      { timeoutMs: 20 },
      (url, init) =>
        new Promise((resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    ),
    (err) => err.kind === KINDS.NO_ANSWER && /20 ms/.test(err.message),
  );
});

test('a refused certificate is its own kind, not "no answer"', async () => {
  for (const code of [
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'ERR_TLS_CERT_ALTNAME_INVALID',
    'CERT_HAS_EXPIRED',
  ]) {
    await assert.rejects(
      httpRequest('https://r/api/x', {}, async () => {
        throw failure(code);
      }),
      (err) => err.kind === KINDS.TLS,
      code,
    );
  }
});

test('answers are capped', async () => {
  await assert.rejects(
    httpRequest('http://r/api/x', { maxBytes: 10 }, async () => new Response('x'.repeat(11))),
    (err) => err.kind === KINDS.BAD_RESPONSE,
  );
  const ok = await httpRequest('http://r/api/x', { maxBytes: 10 }, async () => new Response('{}'));
  assert.equal(ok.body, '{}');
});

test('statuses sorted into kinds, the key never in a message', async () => {
  const answer = (status, headers) => async () =>
    new Response(JSON.stringify({ code: 'X', message: 'secret-key' }), { status, headers });
  const api = (status, headers) =>
    new RemoteApi({
      baseUrl: 'http://r/api/',
      apiKey: 'secret-key',
      fetchImpl: answer(status, headers),
    });
  const kinds = [
    [401, KINDS.REFUSED],
    [403, KINDS.REFUSED],
    [404, KINDS.HTTP],
    [429, KINDS.RATE_LIMITED],
    [500, KINDS.UNAVAILABLE],
    [503, KINDS.UNAVAILABLE],
  ];
  for (const [status, kind] of kinds) {
    await assert.rejects(api(status).battery(), (err) => {
      assert.equal(err.kind, kind, String(status));
      assert.ok(!err.message.includes('secret-key'));
      return true;
    });
  }
  await assert.rejects(
    api(429, { 'retry-after': '30' }).battery(),
    (err) => err.retryAfterMs === 30_000,
  );
  // pub/version goes without the key: a 401 there is not a refused key.
  await assert.rejects(api(401).version(), (err) => err.kind === KINDS.HTTP);
  assert.ok(!JSON.stringify(api(200)).includes('secret-key'));
});

test('a pause holds every call but a protective one', async () => {
  let calls = 0;
  const api = new RemoteApi({
    baseUrl: 'http://r/api/',
    apiKey: 'k',
    pausedUntil: () => Date.now() + 60_000,
    fetchImpl: async () => {
      calls += 1;
      return new Response('{}');
    },
  });
  await assert.rejects(api.battery(), (err) => err.kind === KINDS.PAUSED);
  await assert.rejects(api.activityCommand('a1', true), (err) => err.kind === KINDS.PAUSED);
  await api.activityCommand('a1', false, { protective: true });
  assert.equal(calls, 1);
});
