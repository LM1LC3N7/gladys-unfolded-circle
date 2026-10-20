// -----------------------------------------------------------------------------
// The integration: one Unfolded Circle remote reached on the local network
// through its Core API (REST, API key), read by our own timer (the battery,
// the power mode, the activities and their state), published as one Gladys
// device; the start and stop buttons of each activity. Refusals of the API key
// and 429/5xx pauses are kept in /data. index.js only wires the SDK handlers
// to it (src/handlers.js).
//
// Phases: missing (no address or key), invalid (the address is not one),
// blocked (key refused), paused (429/5xx), connecting, asleep (no answer),
// failing (unexpected answer), ready.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { ACTIVITY_FEATURES, DEVICE_TYPE, LIMITS, TIMINGS } from './constants.js';
import { E, T } from './i18n.js';
import { buildDevice, deviceName, featureKey, parseFeatureKey, stateList } from './model.js';
import { RemoteApi } from './remote/api.js';
import { KINDS, RemoteError } from './remote/errors.js';
import { httpRequest } from './remote/http.js';
import {
  parseActivities,
  parseBattery,
  parsePower,
  parseSystem,
  parseVersion,
} from './remote/parse.js';
import { FileStore, emptyData, newSalt } from './store.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const short = (value) => String(value).slice(0, 48);
/**
 * Errors of a secondary path (battery, power mode, identity refresh) that
 * still stop or pause everything: a refused key, a 429. A 5xx there only
 * leaves its values out.
 */
const SECONDARY_DECISIVE = new Set([KINDS.REFUSED, KINDS.RATE_LIMITED]);
const NO_ANSWER_KINDS = new Set([KINDS.UNREACHABLE, KINDS.NO_ANSWER]);

export class RemoteApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'unfolded-circle' }),
    store = new FileStore(),
    request = httpRequest,
    fetchImpl,
    now = Date.now,
    timers = globalThis,
    timings = TIMINGS,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.store = store;
    this.request = request;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.timers = timers;
    this.timings = timings;
    this.config = normalizeConfig();
    this.data = undefined;
    this.started = false;
    this.generation = 0;
    /** The digest of the address and key the current client was built from. */
    this.activeFingerprint = undefined;
    this.api = undefined;
    this.phase = 'idle';
    this.lastError = undefined;
    /** When the identity of the remote was last read. */
    this.identityAt = undefined;
    /** The last reading: { online, battery?, charging?, powerMode?, activities? }. */
    this.view = undefined;
    this.created = false;
    /** Tail of the queue of start commands. */
    this.queue = Promise.resolve();
    /** activity id -> count of stops asked: a start queued before a stop is dropped. */
    this.stops = new Map();
    /** name -> timer handle */
    this.named = new Map();
    this.persistTimer = undefined;
    this.lastStatus = undefined;
    this.lastDevices = undefined;
    this.polling = undefined;
  }

  // --- Lifecycle -------------------------------------------------------------

  /**
   * (Re)start with a configuration: on every connection to Gladys and on
   * every configuration save. A reconnection to Gladys keeps the client, the
   * pauses and the refusal: only the status, the Discovery and the states
   * the core forgot are published again. A new address or key starts anew.
   */
  async start(raw = {}, { connected = false } = {}) {
    await this.loadData();
    const previousPoll = this.config.pollMs;
    this.config = normalizeConfig(raw, this.data.salt);
    this.started = true;
    if (connected) {
      this.lastStatus = undefined;
      this.lastDevices = undefined;
      this.gladys.forgetPublishedStates?.();
    }
    await this.step('read the Gladys devices', () => this.refreshCreated());
    await this.step('publish the device', () => this.publishDevices({ force: true }));
    if (this.config.fingerprint !== this.activeFingerprint || !this.config.ready) {
      await this.step('connect to the remote', () => this.restart());
    } else if (previousPoll !== this.config.pollMs && this.named.has('poll')) {
      // A new interval: the next reading follows it, counted from now.
      this.setNamed('poll', this.config.pollMs, () => this.poll());
    }
    await this.step('publish the states', () => this.publishStates());
    await this.step('publish the status', () => this.updateStatus());
  }

  async step(name, task) {
    try {
      await task();
    } catch (err) {
      this.logger.warn(`Start: could not ${name}: ${err.message}`);
    }
  }

  async loadData() {
    if (this.data) {
      return;
    }
    try {
      this.data = await this.store.load(this.now());
    } catch {
      this.data = emptyData();
    }
    if (this.store.corrupted) {
      this.logger.warn('Unreadable /data/unfolded-circle.json moved to unfolded-circle.json.bad');
    }
    if (!this.data.salt) {
      // A new salt invalidates nothing: no digest was kept without one.
      this.data.salt = newSalt();
      this.data.block = null;
      this.saveNow();
    }
  }

  async stop() {
    this.started = false;
    this.teardown();
    if (this.persistTimer) {
      this.timers.clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
      this.saveNow();
    }
    await this.store.flush?.().catch(() => {});
  }

  /** Ends the current client: no timer, nothing in flight kept. */
  teardown() {
    this.generation += 1;
    for (const handle of this.named.values()) {
      this.timers.clearTimeout(handle);
    }
    this.named.clear();
    this.api = undefined;
  }

  /** A named background timer (one per name), dropped by teardown(). */
  setNamed(name, ms, task) {
    this.clearNamed(name);
    const generation = this.generation;
    const handle = this.timers.setTimeout(
      () => {
        this.named.delete(name);
        if (generation === this.generation) {
          Promise.resolve()
            .then(task)
            .catch((err) => this.logger.warn(`Background task ${name} failed: ${err.message}`));
        }
      },
      Math.max(0, ms),
    );
    this.named.set(name, handle);
  }

  clearNamed(name) {
    if (this.named.has(name)) {
      this.timers.clearTimeout(this.named.get(name));
      this.named.delete(name);
    }
  }

  persist() {
    if (this.persistTimer) {
      return;
    }
    this.persistTimer = this.timers.setTimeout(() => {
      this.persistTimer = undefined;
      this.saveNow();
    }, this.timings.persistDelay);
  }

  saveNow() {
    return this.store
      .save(this.data)
      .catch((err) => this.logger.warn(`Could not save /data: ${err.message}`));
  }

  // --- Refusals and pauses -----------------------------------------------------

  /** The refusal kept for the configured address and key, if any. */
  get blocked() {
    return this.data?.block?.fingerprint === this.config.fingerprint ? this.data.block : undefined;
  }

  pausedUntil() {
    const until = this.data?.pause?.until ?? 0;
    return until > this.now() ? until : 0;
  }

  /** A 429 or 5xx: every reading (and every start) waits, the end is kept in /data. */
  pause(err) {
    const fallback =
      err?.kind === KINDS.RATE_LIMITED ? this.timings.pause429 : this.timings.pause5xx;
    const wanted = Number.isFinite(err?.retryAfterMs) ? err.retryAfterMs : fallback;
    const until = this.now() + clamp(wanted, this.timings.pauseMin, this.timings.pauseMax);
    if (until > this.pausedUntil()) {
      this.data.pause = { until };
      this.saveNow();
      this.logger.warn(`The remote answered ${err?.status ?? 'an error'}: paused until ${until}`);
    }
  }

  /**
   * The API key refused: kept in /data with the next automatic try (1 h,
   * 6 h, then every 24 h), never sooner. New settings or "Reconnect" try at once.
   */
  async block() {
    const previous = this.blocked;
    const attempts = (previous?.attempts ?? 0) + 1;
    const delays = this.timings.refusedRetry;
    const wait = delays[Math.min(attempts - 1, delays.length - 1)];
    this.data.block = {
      fingerprint: this.config.fingerprint,
      at: this.now(),
      attempts,
      nextAt: this.now() + wait,
    };
    await this.saveNow();
    if (!previous) {
      this.logger.warn('The remote refused the API key: next try by itself later');
    }
    this.phase = 'blocked';
  }

  // --- The remote ----------------------------------------------------------------

  /** A new client from the configured address and key. */
  async restart() {
    this.teardown();
    this.activeFingerprint = this.config.fingerprint;
    this.identityAt = undefined;
    this.lastError = undefined;
    if (this.data.block && this.data.block.fingerprint !== this.config.fingerprint) {
      // Another address or key: the old refusal no longer applies.
      this.data.block = null;
      this.persist();
    }
    if (this.config.ready) {
      this.api = new RemoteApi({
        baseUrl: this.config.baseUrl,
        apiKey: this.config.apiKey,
        request: this.request,
        fetchImpl: this.fetchImpl,
        now: this.now,
        timings: this.timings,
        pausedUntil: () => this.pausedUntil(),
      });
    }
    await this.poll();
  }

  /**
   * One reading, then the next one scheduled (never sooner than the interval).
   * A reading in flight is shared only within the same client (generation): a
   * new key or "Reconnect" never waits on, nor is dropped by, the old one.
   * `again`: a reading asked after a command while one is in flight runs once
   * more after it (never lost).
   */
  async poll({ again = false } = {}) {
    const current = this.polling;
    if (current && current.generation === this.generation) {
      if (again) {
        current.again = true;
      }
      return current.promise;
    }
    const entry = { generation: this.generation, again: false };
    entry.promise = this.pollOnce().finally(() => {
      if (this.polling === entry) {
        this.polling = undefined;
      }
      if (entry.again && entry.generation === this.generation) {
        this.recheck();
      }
    });
    this.polling = entry;
    return entry.promise;
  }

  /** Throws when the client changed meanwhile: nothing of an old reading is kept. */
  alive(generation) {
    if (generation !== this.generation) {
      throw new RemoteError(KINDS.STALE, 'Reading of a previous client');
    }
  }

  async pollOnce() {
    this.clearNamed('poll');
    const generation = this.generation;
    if (!this.config.ready || !this.api) {
      this.phase = this.config.invalidHost ? 'invalid' : 'missing';
      await this.updateStatus();
      return;
    }
    const block = this.blocked;
    if (block && this.now() < block.nextAt) {
      this.phase = 'blocked';
      this.setNamed('poll', block.nextAt - this.now(), () => this.poll());
      await this.updateStatus();
      return;
    }
    const paused = this.pausedUntil();
    if (paused) {
      this.phase = 'paused';
      this.setNamed('poll', Math.max(paused - this.now(), this.config.pollMs), () => this.poll());
      await this.updateStatus();
      return;
    }
    if (this.phase === 'idle' || this.phase === 'missing' || this.phase === 'invalid') {
      this.phase = 'connecting';
      await this.updateStatus();
    }
    let next = this.config.pollMs;
    try {
      await this.read(generation);
      if (generation !== this.generation) {
        return;
      }
      if (this.data.block) {
        this.data.block = null;
        this.persist();
      }
      if (this.phase !== 'ready') {
        this.logger.info('Connected to the remote');
      }
      this.phase = 'ready';
      this.lastError = undefined;
    } catch (err) {
      if (generation !== this.generation) {
        return;
      }
      next = await this.failed(err);
    }
    if (generation === this.generation) {
      this.setNamed('poll', next, () => this.poll());
      await this.updateStatus();
    }
  }

  /** What a failed reading leads to; resolves the wait before the next one. */
  async failed(err) {
    const interval = this.config.pollMs;
    if (err?.kind === KINDS.REFUSED) {
      await this.block();
      return Math.max(interval, this.data.block.nextAt - this.now());
    }
    if (err?.kind === KINDS.RATE_LIMITED || err?.kind === KINDS.UNAVAILABLE) {
      this.pause(err);
    }
    const paused = this.pausedUntil();
    if (paused) {
      this.phase = 'paused';
      return Math.max(interval, paused - this.now());
    }
    if (err?.kind === KINDS.TLS) {
      if (this.phase !== 'tls') {
        this.logger.warn(`${err.message}: use the http:// address of the remote`);
      }
      this.phase = 'tls';
      this.lastError = short(err.message);
      return interval;
    }
    if (NO_ANSWER_KINDS.has(err?.kind)) {
      if (this.phase !== 'asleep') {
        this.logger.info(`The remote does not answer: ${err.message}`);
      }
      this.phase = 'asleep';
      this.view = { ...this.view, online: false };
      this.publishStates();
      return interval;
    }
    const message = short(err?.message ?? String(err));
    if (this.phase !== 'failing' || this.lastError !== message) {
      this.logger.warn(`Unexpected answer of the remote: ${message}`);
    }
    this.phase = 'failing';
    this.lastError = message;
    return interval;
  }

  /**
   * One reading: the identity (at start, then every 6 h), the activities (the
   * main data), the battery and the power mode (secondary: their failure only
   * leaves their values out, unless the remote refused the key or asked to
   * slow down).
   */
  async read(generation = this.generation) {
    const api = this.api;
    if (!this.data.remote) {
      // No identity known yet: without it there is no device, any failure counts.
      await this.readIdentity(api, generation);
    } else if (
      this.identityAt === undefined ||
      this.now() - this.identityAt >= this.timings.infoRefresh
    ) {
      // A remote already known (/data): its identity is only a refresh, at a
      // new client as every 6 h; a 5xx there never hides the activities.
      await this.readIdentity(api, generation).catch((err) => {
        if (
          err?.kind === KINDS.STALE ||
          SECONDARY_DECISIVE.has(err?.kind) ||
          err?.kind === KINDS.TLS ||
          NO_ANSWER_KINDS.has(err?.kind)
        ) {
          throw err;
        }
        // A 5xx or an odd answer: the saved identity is kept, asked again in 6 h.
        this.identityAt = this.now();
        if (this.identityError !== err?.message) {
          this.identityError = err?.message;
          this.logger.warn(`Could not read the identity of the remote: ${err?.message}`);
        }
      });
    }
    // The activities first: a remote asleep costs one request per reading.
    const raw = await api.activities();
    this.alive(generation);
    const list = parseActivities(raw, this.config.language);
    if (!list) {
      throw new RemoteError(KINDS.BAD_RESPONSE, 'The activity list is not a list');
    }
    const [battery, power] = await Promise.allSettled([api.battery(), api.power()]);
    this.alive(generation);
    // A secondary path only stops everything for a refused key or a 429;
    // any other failure (a 5xx included) only leaves its values out.
    const decisive = [battery, power].find(
      (r) => r.status === 'rejected' && SECONDARY_DECISIVE.has(r.reason?.kind),
    );
    if (decisive) {
      throw decisive.reason;
    }
    if (battery.status === 'fulfilled' && power.status === 'fulfilled') {
      this.secondaryError = undefined;
    }
    for (const r of [battery, power]) {
      if (r.status === 'rejected' && this.secondaryError !== r.reason?.message) {
        this.secondaryError = r.reason?.message;
        this.logger.warn(`Secondary value not read: ${short(r.reason?.message)}`);
      }
    }
    const batteryInfo = battery.status === 'fulfilled' ? parseBattery(battery.value) : undefined;
    this.view = {
      online: true,
      battery: batteryInfo?.level,
      charging: batteryInfo?.charging,
      powerMode: power.status === 'fulfilled' ? parsePower(power.value) : undefined,
      activities: list,
    };
    await this.keepActivities(list);
    this.publishStates();
  }

  /**
   * The identity: the serial number (`GET /api/system`, with the key), else
   * the MAC address (`GET /api/pub/version`). A remote already known by its
   * serial or its MAC keeps its id: the external id never changes.
   */
  async readIdentity(api, generation = this.generation) {
    const version = parseVersion(await api.version()) ?? {};
    this.alive(generation);
    const system = parseSystem(await api.system()) ?? {};
    this.alive(generation);
    this.identityError = undefined;
    const stored = this.data.remote;
    const same =
      stored &&
      ((system.serial && stored.serial === system.serial) ||
        (version.mac && stored.mac === version.mac) ||
        (!system.serial && !version.mac));
    const id = same ? stored.id : (system.serial ?? version.mac?.replace(/:/g, ''));
    if (!id) {
      throw new RemoteError(KINDS.BAD_RESPONSE, 'The remote gave neither serial number nor MAC');
    }
    const remote = {
      id,
      serial: system.serial ?? stored?.serial ?? null,
      mac: version.mac ?? stored?.mac ?? null,
      name: system.model ?? version.hostname ?? stored?.name ?? null,
      model: system.model ?? stored?.model ?? null,
    };
    if (!same) {
      // Another remote answers at this address: its activities are its own.
      this.data.activities = Object.create(null);
      this.view = undefined;
    }
    this.identityAt = this.now();
    if (JSON.stringify(remote) !== JSON.stringify(stored)) {
      this.data.remote = remote;
      this.persist();
      await this.refreshCreated().catch(() => {});
      await this.publishDevices();
    }
  }

  /** The activities of the remote, kept in /data; a new list republishes the device. */
  async keepActivities(list) {
    const activities = Object.create(null);
    for (const activity of list.slice(0, LIMITS.activities)) {
      activities[activity.id] = { id: activity.id, name: activity.name };
    }
    if (JSON.stringify(activities) !== JSON.stringify(this.data.activities)) {
      this.data.activities = activities;
      this.persist();
      await this.publishDevices();
    }
  }

  // --- Gladys device and states ----------------------------------------------------

  get remoteExternalId() {
    return this.data?.remote
      ? this.gladys.externalIds(DEVICE_TYPE, this.data.remote.id).device
      : undefined;
  }

  /** The device Gladys has for the remote (kept up to date by the SDK). */
  createdDevice() {
    const externalId = this.remoteExternalId;
    return (Array.isArray(this.gladys.devices) ? this.gladys.devices : []).find(
      (d) => externalId && d?.external_id === externalId,
    );
  }

  async refreshCreated() {
    let devices;
    try {
      devices = await this.gladys.getDevices();
    } catch (err) {
      if (!Array.isArray(this.gladys.devices)) {
        throw err;
      }
      devices = this.gladys.devices;
    }
    const externalId = this.remoteExternalId;
    this.created = Boolean(
      externalId &&
      (Array.isArray(devices) ? devices : []).some((d) => d?.external_id === externalId),
    );
  }

  /** The Discovery tab; only when it changed, unless `force` (start, scan, connected). */
  async publishDevices({ force = false } = {}) {
    if (!this.data?.remote) {
      return;
    }
    const device = buildDevice(
      this.gladys,
      this.data.remote,
      Object.values(this.data.activities),
      this.config.language,
      this.createdDevice(),
    );
    const key = JSON.stringify(device);
    if (!force && key === this.lastDevices) {
      return;
    }
    await this.gladys.publishDiscoveredDevices([device]);
    this.lastDevices = key;
  }

  /** Publishes the states, in the background: never awaited by a command. */
  publishStates() {
    if (!this.data?.remote || !this.created) {
      return;
    }
    const states = stateList(this.gladys, this.data.remote, this.view, this.config.language);
    if (states.length === 0) {
      return;
    }
    Promise.resolve()
      .then(() => this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeat }))
      .catch((err) =>
        this.logger.warn(
          `Could not publish the states of ${deviceName(this.data.remote)}: ${err.message}`,
        ),
      );
  }

  async deviceCreated(device) {
    if (!device || device.external_id !== this.remoteExternalId) {
      return;
    }
    this.created = true;
    this.publishStates();
  }

  async deviceDeleted(device) {
    if (device && device.external_id === this.remoteExternalId) {
      this.created = false;
    }
  }

  // --- Commands ----------------------------------------------------------------------

  /**
   * A press on a start or stop button. A stop is protective: sent at once
   * (never behind the queue of starts, nor held by a pause: one try), and it
   * drops the starts of the same activity still waiting in the queue.
   */
  async setValue(device, feature) {
    const started = this.now();
    if (!device || device.external_id !== this.remoteExternalId) {
      throw new Error(E.unknownRemote);
    }
    const key = featureKey(device.external_id, feature?.external_id);
    const target = parseFeatureKey(key);
    if (target?.kind !== 'activity' || target.suffix === ACTIVITY_FEATURES.STATE) {
      throw new Error(E.notCommand(short(key)));
    }
    // A stop is tried for any activity of the created device, even one /data
    // does not list (a fresh volume, a remote asleep at start); a start needs
    // an activity the remote listed.
    const activity =
      this.data.activities[target.activityId] ??
      (target.suffix === ACTIVITY_FEATURES.OFF
        ? { id: target.activityId, name: target.activityId }
        : undefined);
    if (!activity) {
      throw new Error(E.unknownActivity);
    }
    if (target.suffix === ACTIVITY_FEATURES.OFF) {
      this.stops.set(activity.id, (this.stops.get(activity.id) ?? 0) + 1);
      return this.sendActivity(activity, false, started);
    }
    const stopsSeen = this.stops.get(activity.id) ?? 0;
    const run = this.queue.then(() => {
      if ((this.stops.get(activity.id) ?? 0) !== stopsSeen) {
        throw new RemoteError(KINDS.CANCELLED, E.cancelled);
      }
      return this.sendActivity(activity, true, started);
    });
    this.queue = run.catch(() => {});
    return run;
  }

  remaining(started) {
    return this.timings.commandBudget - (this.now() - started);
  }

  async sendActivity(activity, on, started) {
    if (!this.config.ready || !this.api) {
      throw new Error(E.notConfigured);
    }
    // A stop is protective: tried once even while the key is held as refused
    // (its own 401 changes nothing to the wait) or during a pause.
    if (on && this.blocked) {
      throw new Error(E.blocked);
    }
    if (on && this.pausedUntil()) {
      throw new Error(E.paused);
    }
    const budget = this.remaining(started);
    if (budget < 50) {
      // Gladys stopped waiting while this command was queued: dropped, never sent late.
      throw new RemoteError(KINDS.BUDGET, E.late);
    }
    try {
      await this.api.activityCommand(activity.id, on, { timeoutMs: budget, protective: !on });
    } catch (err) {
      throw this.commandError(err);
    }
    this.recheck();
    return undefined;
  }

  /**
   * The error a failed command acks with, at once: what it changes (a pause,
   * the status) runs in the background, the ack never waits for Gladys nor
   * for /data. A 401/403 of one command does not stop the integration: a
   * reading checks the key, and only a refused reading holds it as refused.
   */
  commandError(err) {
    switch (err?.kind) {
      case KINDS.UNREACHABLE:
        return new RemoteError(err.kind, E.unreachable);
      case KINDS.TLS:
        return new RemoteError(err.kind, E.tls);
      case KINDS.NO_ANSWER:
        this.recheck();
        return new RemoteError(err.kind, E.unconfirmed);
      case KINDS.REFUSED:
        this.recheck();
        return new RemoteError(err.kind, E.refusedCommand(err.status));
      case KINDS.RATE_LIMITED:
        this.pause(err);
        this.background(() => this.updateStatus());
        return new RemoteError(err.kind, E.rateLimited);
      case KINDS.UNAVAILABLE:
        if (err.status === 503) {
          this.pause(err);
          this.background(() => this.updateStatus());
        }
        return new RemoteError(err.kind, E.failed(err.status));
      case KINDS.HTTP:
        return new RemoteError(err.kind, E.failed(err.status));
      case KINDS.PAUSED:
        return new RemoteError(err.kind, E.paused);
      default:
        return err instanceof Error ? err : new Error(String(err));
    }
  }

  /** A task that never holds the caller (its failure is logged). */
  background(task) {
    Promise.resolve()
      .then(task)
      .catch((err) => this.logger.warn(`Background task failed: ${err.message}`));
  }

  /**
   * One reading shortly after a command, not during a pause nor a refusal.
   * Grouped: one waiting at most, and at most one every `recheckSpacing`; a
   * reading in flight meanwhile is followed by one more (never lost).
   */
  recheck() {
    if (this.pausedUntil() || this.blocked || this.named.has('recheck')) {
      return;
    }
    const spaced = (this.lastRecheckAt ?? -Infinity) + this.timings.recheckSpacing - this.now();
    this.setNamed('recheck', Math.max(this.timings.recheckDelay, spaced), () => {
      this.lastRecheckAt = this.now();
      return this.poll({ again: true });
    });
  }

  // --- Configuration button --------------------------------------------------------

  /** "Reconnect": one reading at once, the refusal kept for this key lifted. */
  async reconnect() {
    await this.loadData();
    if (!this.config.ready) {
      return this.config.invalidHost ? T.invalidHost : T.missing;
    }
    const wasBlocked = Boolean(this.blocked);
    if (wasBlocked) {
      // The attempt count stays: a key refused again waits as long as before.
      this.data.block = { ...this.data.block, nextAt: this.now() };
      await this.saveNow();
    }
    await this.restart();
    await this.publishDevices({ force: true }).catch(() => {});
    if (wasBlocked && this.phase === 'blocked') {
      return T.reconnectRefusedAgain;
    }
    return this.statusMessage().message ?? T.connected(Object.keys(this.data.activities).length);
  }

  // --- Status ---------------------------------------------------------------------

  statusMessage() {
    const notes = [];
    if (this.store.corrupted) {
      notes.push(T.dataReset);
    }
    const join = (main) => {
      const all = [main, ...notes].filter(Boolean);
      return all.length
        ? { en: all.map((n) => n.en).join(' '), fr: all.map((n) => n.fr).join(' ') }
        : undefined;
    };
    const nextIn = () => this.config.pollMs;
    switch (this.phase) {
      case 'missing':
        return { connected: false, message: join(T.missing) };
      case 'invalid':
        return { connected: false, message: join(T.invalidHost) };
      case 'blocked':
        return {
          connected: false,
          message: join(T.refused(this.data.block?.nextAt ?? this.now())),
        };
      case 'paused':
        return { connected: false, message: join(T.paused(this.pausedUntil() || this.now())) };
      case 'asleep':
        return { connected: false, message: join(T.asleep(nextIn())) };
      case 'tls':
        return { connected: false, message: join(T.tls(this.lastError)) };
      case 'failing':
        return { connected: false, message: join(T.failing(this.lastError, nextIn())) };
      case 'ready':
        return {
          connected: true,
          message: join(T.connected(Object.keys(this.data.activities).length)),
        };
      default:
        return { connected: false, message: join(T.connecting) };
    }
  }

  async updateStatus() {
    if (!this.started) {
      return;
    }
    const status = this.statusMessage();
    const key = JSON.stringify(status);
    if (key === this.lastStatus) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.lastStatus = key;
    } catch (err) {
      this.logger.warn(`Could not publish the status: ${err.message}`);
    }
  }
}
