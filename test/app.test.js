// -----------------------------------------------------------------------------
// RemoteApp with the SDK's fake Gladys, the exact handlers of the container
// (src/handlers.js), a memory store, a fake remote behind `fetch` and a clock
// the tests move by hand. No network.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { RemoteApp } from '../src/app.js';
import { NOTHING, TIMINGS } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import { MemoryStore } from '../src/store.js';
import { fakeClock } from './helpers/fakeClock.js';
import { API_KEY, MUSIC, SERIAL, TV, fakeRemote } from './helpers/fakeRemote.js';

const SELECTOR = 'unfolded-circle';
const CONFIG = { host: '192.168.1.20', api_key: API_KEY };
const id = (key) => `ext:${SELECTOR}:remote:${SERIAL}${key ? `:${key}` : ''}`;
const act = (activity, suffix) => id(`act:${activity}:${suffix}`);
const MINUTE = 60_000;

async function setup(
  t,
  { config = CONFIG, store = new MemoryStore(), clock = fakeClock(), remote = fakeRemote() } = {},
) {
  const gladys = createFakeGladys({ selector: SELECTOR, config });
  const logs = [];
  const logger = Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (...args) => logs.push(`${level} ${args.map((a) => a?.message ?? a).join(' ')}`),
    ]),
  );
  const app = new RemoteApp({
    gladys,
    logger,
    store,
    fetchImpl: remote.fetch,
    now: clock.now,
    timers: clock.timers,
  });
  registerHandlers(gladys, app, logger);
  await gladys.connect();
  await clock.settle();
  t.after(() => app.stop());
  return { gladys, app, remote, clock, store, logs };
}

async function createRemote(gladys, clock) {
  const device = gladys.fake.discoveredDevices.findLast((d) => d.external_id === id());
  assert.ok(device, 'the remote is in the Discovery tab');
  gladys.fake.devices.push(device);
  await gladys.fake.deviceCreated(device);
  await clock.settle();
  return device;
}

const press = (gladys, device, externalId) =>
  gladys.fake.setValue(
    device,
    device.features.find((f) => f.external_id === externalId),
    1,
  );

async function created(t, options) {
  const env = await setup(t, options);
  const device = await createRemote(env.gladys, env.clock);
  return { ...env, device };
}

test('discovery: one device keyed by the serial number, buttons and read-only states', async (t) => {
  const { gladys, remote, app } = await setup(t);
  const [device] = gladys.fake.discoveredDevices;
  assert.equal(device.external_id, id());
  assert.equal(device.name, 'Remote 3');
  const keys = device.features.map((f) => f.external_id.slice(id().length + 1));
  assert.deepEqual(keys, [
    'battery',
    'charging',
    'online',
    'power_mode',
    'activity',
    `act:${TV}:state`,
    `act:${TV}:on`,
    `act:${TV}:off`,
    `act:${MUSIC}:state`,
    `act:${MUSIC}:on`,
    `act:${MUSIC}:off`,
  ]);
  const byKey = Object.fromEntries(device.features.map((f) => [f.external_id, f]));
  // No switch: nothing an "everything off" could command.
  assert.ok(device.features.every((f) => f.category !== 'switch'));
  assert.deepEqual(
    [byKey[id('battery')].category, byKey[id('battery')].type, byKey[id('battery')].unit],
    ['battery', 'integer', 'percent'],
  );
  assert.deepEqual(
    [byKey[id('charging')].category, byKey[id('charging')].type, byKey[id('charging')].unit],
    ['battery', 'charging', undefined],
  );
  assert.deepEqual(
    [
      byKey[act(TV, 'state')].category,
      byKey[act(TV, 'state')].type,
      byKey[act(TV, 'state')].read_only,
    ],
    ['unknown', 'binary', true],
  );
  for (const suffix of ['on', 'off']) {
    const f = byKey[act(TV, suffix)];
    assert.deepEqual([f.category, f.type, f.read_only], ['button', 'push', false]);
  }
  assert.equal(byKey[act(TV, 'on')].name, 'Démarrer Regarder la TV', 'French names by default');
  assert.equal(byKey[act(MUSIC, 'off')].name, 'Arrêter Music');
  assert.ok(device.features.every((f) => f.unit === undefined || f.unit === 'percent'));

  // The key only in the Authorization header, never in a URL; pub/version without it.
  const version = remote.requests.find((r) => r.path === 'pub/version');
  assert.equal(version.headers.authorization, undefined);
  const activities = remote.requests.find((r) => r.path === 'activities');
  assert.equal(activities.headers.authorization, `Bearer ${API_KEY}`);
  assert.ok(remote.requests.every((r) => !r.url.includes(API_KEY)));
  assert.ok(remote.requests.every((r) => r.init.redirect === 'manual'));
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(gladys.fake.connectionStatus.message.en, /2 activities/);
  assert.equal(app.phase, 'ready');
});

test('states once created, read again every interval, never sooner', async (t) => {
  const { gladys, remote, clock } = await created(t);
  assert.equal(gladys.fake.lastState(id('battery')), 87);
  assert.equal(gladys.fake.lastState(id('charging')), 0);
  assert.equal(gladys.fake.lastState(id('online')), 1);
  assert.equal(gladys.fake.lastState(id('power_mode')), 'Normal');
  assert.equal(gladys.fake.lastState(id('activity')), 'Music');
  assert.equal(gladys.fake.lastState(act(TV, 'state')), 0);
  assert.equal(gladys.fake.lastState(act(MUSIC, 'state')), 1);

  const before = remote.reads('activities');
  await clock.advance(59_000);
  assert.equal(remote.reads('activities'), before, 'not before the interval');
  remote.battery = { capacity: 54.6, status: 'CHARGING', power_supply: true };
  remote.activities[1].attributes.state = 'OFF';
  await clock.advance(1_000);
  assert.equal(remote.reads('activities'), before + 1);
  assert.equal(gladys.fake.lastState(id('battery')), 55);
  assert.equal(gladys.fake.lastState(id('charging')), 1);
  assert.equal(gladys.fake.lastState(id('activity')), NOTHING);
  assert.equal(gladys.fake.lastState(act(MUSIC, 'state')), 0);
  // The identity is not read at every reading.
  assert.equal(remote.reads('system'), 1);
});

test('a remote asleep: reachable 0, read again at the interval, logged once', async (t) => {
  const { gladys, remote, clock, logs } = await created(t);
  remote.mode = 'asleep';
  await clock.advance(MINUTE);
  assert.equal(gladys.fake.lastState(id('online')), 0);
  assert.equal(gladys.fake.lastState(id('battery')), 87, 'the last value stays');
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /does not answer/);
  const reads = remote.requests.length;
  await clock.advance(MINUTE - 1);
  assert.equal(remote.requests.length, reads, 'never sooner than the interval');
  await clock.advance(2 * MINUTE + 1);
  assert.equal(logs.filter((l) => l.includes('does not answer')).length, 1);
  remote.mode = 'up';
  await clock.advance(MINUTE);
  assert.equal(gladys.fake.lastState(id('online')), 1);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('start and stop buttons send activity.on / activity.off, then read again', async (t) => {
  const { gladys, remote, clock, device } = await created(t);
  const ack = await press(gladys, device, act(TV, 'on'));
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(remote.commands, [[TV, 'activity.on']]);
  const put = remote.requests.find((r) => r.method === 'PUT');
  assert.equal(put.path, `entities/${TV}/command`);
  assert.equal(put.headers['content-type'], 'application/json');
  await clock.advance(TIMINGS.recheckDelay);
  assert.equal(gladys.fake.lastState(act(TV, 'state')), 1);
  assert.equal(gladys.fake.lastState(id('activity')), 'Regarder la TV, Music');
  const off = await press(gladys, device, act(MUSIC, 'off'));
  assert.equal(off.success, true, off.error);
  assert.deepEqual(remote.commands.at(-1), [MUSIC, 'activity.off']);
});

test('a read-only feature and an unknown activity cannot be commanded', async (t) => {
  const { gladys, remote, device } = await created(t);
  const state = await press(gladys, device, act(TV, 'state'));
  assert.equal(state.success, false);
  assert.match(state.error, /cannot be commanded/);
  const battery = await press(gladys, device, id('battery'));
  assert.equal(battery.success, false);
  const ghost = await gladys.fake.setValue(
    device,
    { external_id: act('uc.main.gone', 'on'), category: 'button', type: 'push' },
    1,
  );
  assert.equal(ghost.success, false);
  assert.match(ghost.error, /no longer on the remote/);
  assert.equal(remote.commands.length, 0);
});

test('a stop drops the starts of the same activity still waiting', async (t) => {
  const { gladys, remote, device, app } = await created(t);
  // Holds the queue: a start in flight.
  let release;
  app.queue = new Promise((resolve) => {
    release = resolve;
  });
  const start = press(gladys, device, act(TV, 'on'));
  const stop = press(gladys, device, act(TV, 'off'));
  const stopAck = await stop;
  assert.equal(stopAck.success, true, 'the stop is not held by the queue');
  release();
  const startAck = await start;
  assert.equal(startAck.success, false);
  assert.match(startAck.error, /Cancelled by a later stop/);
  assert.deepEqual(remote.commands, [[TV, 'activity.off']]);
});

test('no answer to a command: "sent, without confirmation"; unreachable: "nothing sent"', async (t) => {
  const { gladys, remote, device } = await created(t);
  remote.mode = 'dropped';
  const dropped = await press(gladys, device, act(TV, 'on'));
  assert.equal(dropped.success, false);
  assert.match(dropped.error, /sent, without confirmation/);
  remote.mode = 'asleep';
  const asleep = await press(gladys, device, act(TV, 'on'));
  assert.match(asleep.error, /unreachable.*nothing sent/);
});

test('429: paused (Retry-After bounded), kept in /data; a stop still goes, a start does not', async (t) => {
  const store = new MemoryStore();
  const { gladys, remote, clock, device } = await created(t, { store });
  remote.statuses.set('activities', 429);
  remote.retryAfter.set('activities', '999999');
  await clock.advance(MINUTE);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /slow down/);
  assert.equal(store.data.pause.until, clock.now() + TIMINGS.pauseMax, 'bounded to 6 h');
  remote.statuses.clear();
  const reads = remote.requests.length;
  await clock.advance(3 * 3_600_000);
  assert.equal(remote.requests.length, reads, 'nothing read during the pause');

  const start = await press(gladys, device, act(TV, 'on'));
  assert.equal(start.success, false);
  assert.match(start.error, /slow down/);
  const stop = await press(gladys, device, act(MUSIC, 'off'));
  assert.equal(stop.success, true, stop.error);
  assert.deepEqual(remote.commands, [[MUSIC, 'activity.off']]);

  await clock.advance(3 * 3_600_000);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('5xx of the activities: a pause of 5 minutes at least, never a fast loop', async (t) => {
  const { gladys, remote, clock } = await created(t);
  remote.statuses.set('activities', 500);
  await clock.advance(MINUTE);
  assert.match(gladys.fake.connectionStatus.message.en, /busy \(5xx\)/);
  const reads = remote.requests.length;
  await clock.advance(TIMINGS.pause5xx - 1);
  assert.equal(remote.requests.length, reads);
  remote.statuses.clear();
  await clock.advance(1);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('5xx of a secondary path: only its values left out, no pause', async (t) => {
  const { gladys, remote, clock, device, app } = await created(t);
  remote.statuses.set('system/power/battery', 500);
  remote.statuses.set('system', 503);
  remote.activities[0].attributes.state = 'ON';
  await clock.advance(7 * 3_600_000);
  assert.equal(app.phase, 'ready');
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(app.data.pause, null);
  assert.equal(gladys.fake.lastState(act(TV, 'state')), 1, 'the main data still follows');
  assert.equal(gladys.fake.lastState(id('power_mode')), 'Normal');
  const start = await press(gladys, device, act(MUSIC, 'on'));
  assert.equal(start.success, true, start.error);
  // A 429 there still pauses.
  remote.statuses.set('system/power', 429);
  await clock.advance(MINUTE);
  assert.equal(app.phase, 'paused');
});

test('a restart with a known remote whose /system answers 500: still connected, activities followed', async (t) => {
  const store = new MemoryStore();
  const clock = fakeClock();
  const remote = fakeRemote();
  const first = await created(t, { store, clock, remote });
  await first.app.stop();
  remote.statuses.set('system', 500);
  remote.activities[0].attributes.state = 'ON';
  const { gladys, app, logs } = await setup(t, { store, clock, remote });
  gladys.fake.devices.push(first.device);
  await gladys.fake.deviceCreated(first.device);
  const before = remote.reads('activities');
  await clock.advance(60 * MINUTE);
  assert.equal(app.phase, 'ready');
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(app.data.pause, null);
  assert.ok(remote.reads('activities') - before >= 60, 'the activities are read every minute');
  assert.equal(gladys.fake.lastState(act(TV, 'state')), 1);
  assert.equal(app.data.remote.id, SERIAL, 'the saved identity is kept');
  assert.equal(remote.reads('system'), 2, 'asked once at start, then not before 6 h');
  assert.equal(logs.filter((l) => l.includes('identity')).length, 1, 'logged once');
  const start = await press(gladys, first.device, act(MUSIC, 'on'));
  assert.equal(start.success, true, start.error);

  // Without any saved identity, the same 500 still pauses (no device without it).
  const fresh = fakeRemote();
  fresh.statuses.set('system', 500);
  const other = await setup(t, { remote: fresh });
  assert.equal(other.app.phase, 'paused');
});

test('a new key or "Reconnect" while a reading is in flight: the new client reads on', async (t) => {
  const remote = fakeRemote();
  const inner = remote.fetch;
  let gate;
  remote.fetch = async (url, init) => {
    if (gate && new URL(url).pathname.endsWith('/activities')) {
      await gate;
    }
    return inner(url, init);
  };
  const hold = () => {
    let release;
    gate = new Promise((resolve) => {
      release = resolve;
    });
    return () => {
      gate = undefined;
      release();
    };
  };
  const { gladys, app, clock } = await created(t, { remote });
  let release = hold();
  await clock.advance(MINUTE);
  assert.ok(app.polling, 'a reading is in flight');
  remote.key = 'new-key';
  const saved = gladys.fake.configUpdated({ ...CONFIG, api_key: 'new-key' });
  await clock.settle();
  release();
  await saved;
  await clock.advance(5 * MINUTE);
  const withNewKey = remote.requests.filter((r) => r.headers.authorization === 'Bearer new-key');
  assert.ok(withNewKey.length >= 5 * 3, `new key used: ${withNewKey.length}`);
  assert.ok(clock.due().length >= 1, 'a reading stays scheduled');

  release = hold();
  await clock.advance(MINUTE);
  const ack = gladys.fake.action('reconnect');
  await clock.settle();
  release();
  await ack;
  const before = remote.requests.length;
  await clock.advance(3 * MINUTE);
  assert.ok(remote.requests.length - before >= 9, 'readings go on after Reconnect');
  assert.equal(app.phase, 'ready');
});

test('the ack of a refused command never waits for Gladys nor /data', async (t) => {
  const { gladys, remote, device } = await created(t);
  gladys.setConnectionStatus = () => new Promise(() => {});
  remote.statuses.set(`entities/${TV}/command`, 429);
  const ack = await Promise.race([
    press(gladys, device, act(TV, 'on')),
    new Promise((resolve) => setTimeout(() => resolve('held'), 300)),
  ]);
  assert.notEqual(ack, 'held');
  assert.match(ack.error, /slow down/);
  remote.statuses.clear();
  remote.key = 'revoked';
  const refused = await Promise.race([
    press(gladys, device, act(MUSIC, 'off')),
    new Promise((resolve) => setTimeout(() => resolve('held'), 300)),
  ]);
  assert.notEqual(refused, 'held');
});

test('a 403 on one command does not stop the integration; a stop is tried even when blocked', async (t) => {
  const { gladys, remote, clock, device, app, store } = await created(t);
  remote.statuses.set(`entities/${TV}/command`, 403);
  const ack = await press(gladys, device, act(TV, 'on'));
  assert.match(ack.error, /Refused by the remote \(403\)/);
  await clock.advance(TIMINGS.recheckDelay);
  assert.equal(app.phase, 'ready', 'the key is fine: a reading said so');
  assert.equal(store.data.block, null);

  // The key really refused: the reading blocks; a stop is still tried once.
  remote.statuses.clear();
  remote.key = 'revoked';
  await clock.advance(MINUTE);
  assert.equal(app.phase, 'blocked');
  const nextAt = app.data.block.nextAt;
  const sent = remote.requests.length;
  const stop = await press(gladys, device, act(MUSIC, 'off'));
  assert.equal(remote.requests.length, sent + 1, 'the stop went out');
  assert.match(stop.error, /Refused by the remote \(401\)/);
  assert.equal(app.data.block.nextAt, nextAt, 'the wait is not made longer');
  const start = await press(gladys, device, act(TV, 'on'));
  assert.match(start.error, /refused the API key: nothing sent/);
  assert.equal(remote.requests.length, sent + 1);
});

test('a stop of an activity /data does not list is still sent', async (t) => {
  const { gladys, remote, device, app } = await created(t);
  app.data.activities = Object.create(null);
  const stop = await press(gladys, device, act(MUSIC, 'off'));
  assert.equal(stop.success, true, stop.error);
  assert.deepEqual(remote.commands.at(-1), [MUSIC, 'activity.off']);
  const start = await press(gladys, device, act(MUSIC, 'on'));
  assert.match(start.error, /no longer on the remote/);
});

test('readings after commands are grouped, and one asked during a reading is not lost', async (t) => {
  const { gladys, remote, clock, device } = await created(t);
  const before = remote.reads('activities');
  for (let i = 0; i < 20; i += 1) {
    await press(gladys, device, act(TV, i % 2 ? 'off' : 'on'));
    await clock.advance(2_500);
  }
  const reads = remote.reads('activities') - before;
  assert.ok(reads <= 6, `readings in 50 s: ${reads}`);
  assert.ok(reads >= 4);
});

test('a reading asked after a command while one is in flight runs after it', async (t) => {
  const remote = fakeRemote();
  const inner = remote.fetch;
  let gate;
  let release;
  remote.fetch = async (url, init) => {
    if (gate && new URL(url).pathname.endsWith('/activities')) {
      await gate;
    }
    return inner(url, init);
  };
  const { gladys, clock, device } = await created(t, { remote });
  gate = new Promise((resolve) => {
    release = resolve;
  });
  await clock.advance(MINUTE);
  const ack = await press(gladys, device, act(TV, 'on'));
  assert.equal(ack.success, true, ack.error);
  await clock.advance(TIMINGS.recheckDelay);
  gate = undefined;
  release();
  await clock.settle();
  const after = remote.reads('activities');
  await clock.advance(TIMINGS.recheckSpacing);
  assert.equal(remote.reads('activities'), after + 1, 'the reading asked meanwhile ran');
  assert.equal(gladys.fake.lastState(act(TV, 'state')), 1);
});

test('a remote asleep costs one request per reading', async (t) => {
  const { remote, clock } = await created(t);
  remote.mode = 'asleep';
  const n = remote.requests.length;
  await clock.advance(10 * MINUTE);
  assert.equal(remote.requests.length - n, 10);
});

test('an https address with a refused certificate: said in the status, nothing sent', async (t) => {
  const remote = fakeRemote();
  const inner = remote.fetch;
  let tls = false;
  remote.fetch = async (url, init) => {
    if (tls) {
      throw Object.assign(new TypeError('fetch failed'), {
        cause: { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' },
      });
    }
    return inner(url, init);
  };
  const { gladys, clock, device, app } = await created(t, { remote });
  tls = true;
  await clock.advance(MINUTE);
  assert.equal(app.phase, 'tls');
  assert.match(gladys.fake.connectionStatus.message.en, /certificate of the remote was refused/);
  assert.match(gladys.fake.connectionStatus.message.fr, /certificat/);
  const ack = await press(gladys, device, act(TV, 'on'));
  assert.match(ack.error, /certificate.*nothing sent/);
});

test('a refused key: stop kept in /data, spaced tries, new key or Reconnect try at once', async (t) => {
  const store = new MemoryStore();
  const clock = fakeClock();
  const remote = fakeRemote();
  const { gladys, app, logs } = await setup(t, { store, clock, remote });
  remote.key = 'another-key';
  await clock.advance(MINUTE);
  assert.equal(app.phase, 'blocked');
  assert.match(gladys.fake.connectionStatus.message.en, /refused the API key/);
  assert.equal(store.data.block.attempts, 1);
  assert.equal(store.data.block.nextAt, clock.now() + TIMINGS.refusedRetry[0]);
  // No retry before the hour, then 6 h.
  const reads = remote.requests.length;
  await clock.advance(TIMINGS.refusedRetry[0] - 1);
  assert.equal(remote.requests.length, reads);
  await clock.advance(1);
  assert.ok(remote.requests.length > reads);
  assert.equal(store.data.block.attempts, 2);
  assert.equal(store.data.block.nextAt, clock.now() + TIMINGS.refusedRetry[1]);
  assert.equal(logs.filter((l) => l.includes('refused the API key')).length, 1);

  // A reconnection to Gladys keeps the stop.
  const before = remote.requests.length;
  await app.start(CONFIG, { connected: true });
  await clock.settle();
  assert.equal(remote.requests.length, before, 'no try on a reconnection to Gladys');
  assert.equal(app.phase, 'blocked');

  // "Reconnect": one try.
  const again = await gladys.fake.action('reconnect');
  assert.match(again.data?.en ?? JSON.stringify(again), /still refuses/);
  assert.equal(store.data.block.attempts, 3);

  // The new key: tried at once, the stop lifted.
  await gladys.fake.configUpdated({ ...CONFIG, api_key: 'another-key' });
  await clock.advance(TIMINGS.persistDelay);
  assert.equal(app.phase, 'ready');
  assert.equal(store.data.block, null);
});

test('a restart keeps the refusal of the same key', async (t) => {
  const store = new MemoryStore();
  const remote = fakeRemote({ key: 'not-this-one' });
  const clock = fakeClock();
  const first = await setup(t, { store, clock, remote });
  assert.equal(first.app.phase, 'blocked');
  await first.app.stop();
  const reads = remote.requests.length;
  const second = await setup(t, { store, clock, remote });
  assert.equal(second.app.phase, 'blocked');
  assert.equal(remote.requests.length, reads, 'nothing sent at the restart');
});

test('the API key is never logged, saved, or shown in a status', async (t) => {
  const store = new MemoryStore();
  const remote = fakeRemote();
  const { gladys, clock, logs, device } = await created(t, { store, remote });
  remote.mode = 'asleep';
  await clock.advance(MINUTE);
  await press(gladys, device, act(TV, 'on'));
  remote.mode = 'up';
  remote.key = 'revoked';
  await clock.advance(MINUTE);
  const everything = JSON.stringify([
    logs,
    store.data,
    gladys.fake.connectionStatuses,
    gladys.fake.discoveredDevices,
    gladys.fake.states,
  ]);
  assert.ok(!everything.includes(API_KEY));
});

test('connected again: status and Discovery published again, pause kept', async (t) => {
  const { gladys, remote, clock, app } = await created(t);
  remote.statuses.set('activities', 429);
  await clock.advance(MINUTE);
  const discoveries = gladys.fake.bodies('POST', '/discovered_device').length;
  const statuses = gladys.fake.connectionStatuses.length;
  remote.statuses.clear();
  const reads = remote.requests.length;
  await app.start(CONFIG, { connected: true });
  await clock.settle();
  assert.ok(
    gladys.fake.bodies('POST', '/discovered_device').length > discoveries,
    'Discovery published again',
  );
  assert.ok(gladys.fake.connectionStatuses.length > statuses, 'status published again');
  assert.equal(app.phase, 'paused');
  assert.equal(remote.requests.length, reads, 'the pause is kept');
});

test('an activity deleted on the remote: the device keeps its features', async (t) => {
  const { gladys, remote, clock } = await created(t);
  remote.activities = remote.activities.filter((a) => a.entity_id !== TV);
  await clock.advance(MINUTE);
  const device = gladys.fake.discoveredDevices.findLast((d) => d.external_id === id());
  const ids = device.features.map((f) => f.external_id);
  assert.ok(ids.includes(act(TV, 'on')), 'the feature of the created device stays');
  assert.ok(ids.includes(act(MUSIC, 'on')));
});

test('missing or invalid configuration: nothing sent, said in the status', async (t) => {
  const remote = fakeRemote();
  const { gladys, app } = await setup(t, { config: { host: '', api_key: '' }, remote });
  assert.equal(remote.requests.length, 0);
  assert.equal(app.phase, 'missing');
  await gladys.fake.configUpdated({ host: 'http://user:pw@192.168.1.20/x', api_key: API_KEY });
  assert.equal(app.phase, 'invalid');
  assert.match(gladys.fake.connectionStatus.message.en, /not a plain address/);
  assert.equal(remote.requests.length, 0);
});
