// -----------------------------------------------------------------------------
// What the integration keeps across restarts, in /data (the one writable
// volume, file mode 0600). Never the API key.
//
//   remote      the identity of the remote (id, serial, MAC, name, model), so
//               the Discovery tab is filled again while it sleeps;
//   activities  its activities (id, name), for the same reason;
//   block       a refusal of the API key (digest, time, attempts, next try);
//   pause       the end of a pause asked by the remote (429, 5xx);
//   salt        the random salt of the credential digest (scrypt).
//
// The activity ids come from the network: the table has no prototype, and an
// id that is not a plain identifier is never a key.
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { LIMITS, TIMINGS } from './constants.js';
import { cleanText, isSafeId } from './remote/parse.js';

export const emptyData = () => ({
  remote: null,
  activities: Object.create(null),
  block: null,
  pause: null,
  salt: null,
});

const HEX = /^[0-9a-f]{64}$/;
const SALT = /^[0-9a-f]{32}$/;
const MAC = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/;
const MAX_REFUSED_WAIT = Math.max(...TIMINGS.refusedRetry);

/** A new random salt. */
export const newSalt = () => randomBytes(16).toString('hex');
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const count = (v) => (Number.isInteger(v) && v >= 0 && v < 1_000 ? v : 0);

/** The saved data, checked field by field; `now` bounds the saved times. */
export function sanitize(data, now = Date.now()) {
  const base = emptyData();
  if (!isObject(data)) {
    return base;
  }
  const r = data.remote;
  if (isObject(r) && isSafeId(r.id)) {
    base.remote = {
      id: r.id,
      serial: isSafeId(r.serial) ? r.serial : null,
      mac: typeof r.mac === 'string' && MAC.test(r.mac) ? r.mac : null,
      name: cleanText(r.name, LIMITS.name) ?? null,
      model: cleanText(r.model, LIMITS.name) ?? null,
    };
  }
  if (isObject(data.activities)) {
    for (const [id, activity] of Object.entries(data.activities).slice(0, LIMITS.activities)) {
      if (isSafeId(id) && isObject(activity) && activity.id === id) {
        base.activities[id] = { id, name: cleanText(activity.name, LIMITS.name) ?? id };
      }
    }
  }
  const b = data.block;
  if (isObject(b) && HEX.test(b.fingerprint)) {
    const at = Number.isFinite(b.at) && b.at <= now ? b.at : now;
    base.block = {
      fingerprint: b.fingerprint,
      at,
      attempts: count(b.attempts),
      // A saved next try is never trusted beyond the longest wait.
      nextAt: Number.isFinite(b.nextAt) ? Math.min(b.nextAt, now + MAX_REFUSED_WAIT) : now,
    };
  }
  const p = data.pause;
  if (isObject(p) && Number.isFinite(p.until) && p.until > now) {
    // A saved end is never trusted beyond the longest pause.
    base.pause = { until: Math.min(p.until, now + TIMINGS.pauseMax) };
  }
  if (typeof data.salt === 'string' && SALT.test(data.salt)) {
    base.salt = data.salt;
  }
  return base;
}

export class FileStore {
  constructor({ dir = process.env.DATA_DIR || '/data', name = 'unfolded-circle.json' } = {}) {
    this.dir = dir;
    this.path = join(dir, name);
    this.corrupted = false;
    /** The writes, one after the other: the last save always lands last. */
    this.queue = Promise.resolve();
    this.writes = 0;
  }

  /**
   * The saved data. An unreadable file is moved aside to `<name>.bad` and
   * `corrupted` is set, so the app says so instead of silently starting over.
   */
  async load(now = Date.now()) {
    let text;
    try {
      text = await readFile(this.path, 'utf8');
    } catch {
      return emptyData();
    }
    try {
      return sanitize(JSON.parse(text), now);
    } catch {
      this.corrupted = true;
      const bad = `${this.path}.bad`;
      await rename(this.path, bad).catch(() => {});
      await chmod(bad, 0o600).catch(() => {});
      return emptyData();
    }
  }

  /**
   * Saves a snapshot of `data` (taken now), after the writes already queued.
   * Each write goes to its own temporary file, flushed to the disk, then
   * renamed over the file: a crash never leaves a half-written file.
   */
  save(data) {
    const text = JSON.stringify(data);
    const run = this.queue.then(() => this.write(text));
    this.queue = run.catch(() => {});
    return run;
  }

  /** Resolves once every queued write ended. */
  flush() {
    return this.queue;
  }

  async write(text) {
    await mkdir(this.dir, { recursive: true });
    this.writes += 1;
    const temporary = `${this.path}.${process.pid}.${this.writes}.${randomBytes(4).toString('hex')}.tmp`;
    const handle = await open(temporary, 'w', 0o600);
    try {
      await handle.writeFile(text);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, this.path);
    } catch (err) {
      await rm(temporary, { force: true }).catch(() => {});
      throw err;
    }
  }
}

/** For the tests. */
export class MemoryStore {
  constructor(data = emptyData()) {
    this.data = JSON.parse(JSON.stringify(data));
    this.saves = 0;
    this.corrupted = false;
  }

  async load(now = Date.now()) {
    return sanitize(JSON.parse(JSON.stringify(this.data)), now);
  }

  async save(data) {
    // Through JSON, as the file store: what a restart would read back.
    this.data = JSON.parse(JSON.stringify(data));
    this.saves += 1;
  }

  flush() {
    return Promise.resolve();
  }
}
