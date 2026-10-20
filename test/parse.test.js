import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanText,
  isSafeId,
  parseActivities,
  parseBaseUrl,
  parseBattery,
  parsePower,
  parseSystem,
  parseVersion,
  pickText,
} from '../src/remote/parse.js';

test('parseBaseUrl: plain hosts only', () => {
  assert.equal(parseBaseUrl('192.168.1.20'), 'http://192.168.1.20/api/');
  assert.equal(parseBaseUrl(' remote.local:8080 '), 'http://remote.local:8080/api/');
  assert.equal(parseBaseUrl('http://192.168.1.20/'), 'http://192.168.1.20/api/');
  assert.equal(parseBaseUrl('https://remote.local/api'), 'https://remote.local/api/');
  assert.equal(parseBaseUrl('[fe80::1]'), 'http://[fe80::1]/api/');
  for (const bad of [
    '',
    'ftp://remote',
    'http://user:pw@remote',
    'http://remote/other',
    'http://remote/?a=1',
    'remote#x',
    'a b',
    'x'.repeat(300),
    undefined,
    42,
  ]) {
    assert.equal(parseBaseUrl(bad), undefined, String(bad));
  }
});

test('isSafeId refuses prototype keys and odd characters', () => {
  assert.ok(isSafeId('uc.main.0b1c-2d3e_4'));
  for (const bad of [
    '__proto__',
    'constructor',
    'prototype',
    'a:b',
    'a/b',
    '',
    'x'.repeat(81),
    1,
  ]) {
    assert.equal(isSafeId(bad), false, String(bad));
  }
});

test('pickText follows the language, then English, then anything', () => {
  const name = { en_US: 'Watch TV', fr_FR: 'Regarder la TV', de: 'Fernsehen' };
  assert.equal(pickText(name, 'fr'), 'Regarder la TV');
  assert.equal(pickText(name, 'en'), 'Watch TV');
  assert.equal(pickText({ de: 'Fernsehen' }, 'fr'), 'Fernsehen');
  assert.equal(pickText('Plain', 'fr'), 'Plain');
  assert.equal(pickText({ fr: '' }, 'fr'), undefined);
  assert.equal(pickText(null), undefined);
  assert.equal(cleanText('a\u0000b\nc'), 'a b c');
});

test('the readers bound and check every field', () => {
  assert.deepEqual(parseVersion({ hostname: 'UC', address: 'A0-B1-C2-D3-E4-F5', os: '2.6.9' }), {
    hostname: 'UC',
    mac: 'a0:b1:c2:d3:e4:f5',
    firmware: '2.6.9',
  });
  assert.equal(parseVersion({ address: 'nope' }).mac, undefined);
  assert.equal(parseSystem({ serial_number: '__proto__' }).serial, undefined);
  assert.equal(parseSystem({ serial_number: 'SN1', model_name: 'Remote Two' }).model, 'Remote Two');
  assert.deepEqual(parseBattery({ capacity: 120, power_supply: true }), {
    level: 100,
    charging: true,
  });
  assert.deepEqual(parseBattery({ capacity: '50', power_supply: 'yes' }), {
    level: undefined,
    charging: undefined,
  });
  assert.equal(parsePower({ mode: 'SUSPEND' }), 'SUSPEND');
  assert.equal(parsePower({ mode: 'WEIRD' }), undefined);
  assert.equal(parseVersion('x'), undefined);
});

test('parseActivities: safe ids, each once, capped, known states only', () => {
  const list = parseActivities(
    [
      { entity_id: 'a1', name: { en: 'One' }, attributes: { state: 'ON' } },
      { entity_id: 'a1', name: { en: 'Again' }, attributes: { state: 'OFF' } },
      { entity_id: '__proto__', name: 'Bad', attributes: { state: 'ON' } },
      { entity_id: 'a2', attributes: { state: 'RUNNING' } },
      'junk',
    ],
    'en',
  );
  assert.deepEqual(list, [
    { id: 'a1', name: 'One', state: 'ON' },
    { id: 'a2', name: 'a2', state: undefined },
  ]);
  const many = Array.from({ length: 80 }, (_, i) => ({ entity_id: `a${i}`, attributes: {} }));
  assert.equal(parseActivities(many).length, 50);
  assert.equal(parseActivities({}), undefined);
});
