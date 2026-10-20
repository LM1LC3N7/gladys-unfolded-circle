// -----------------------------------------------------------------------------
// Frozen keys (external ids, features, manifest actions), the remote API paths,
// limits and timings. Every key here is stored by Gladys or by its users:
// never rename one.
// -----------------------------------------------------------------------------

/** `gladys.externalIds(DEVICE_TYPE, <serial number, else MAC address of the remote>)`. */
export const DEVICE_TYPE = 'remote';

export const FEATURES = Object.freeze({
  /** Read only: charge level, %. */
  BATTERY: 'battery',
  /** Read only: 1 on its charger (dock or cable), 0 otherwise. */
  CHARGING: 'charging',
  /** Read only: 1 the remote answered the last reading, 0 not (asleep, off the network). */
  ONLINE: 'online',
  /** Read only text: the power mode of the remote (normal, idle, low power, suspend). */
  POWER_MODE: 'power_mode',
  /** Read only text: the names of the activities running, "—" when none. */
  ACTIVITY: 'activity',
});

/**
 * The features of one activity: `act:<activity id>:<suffix>`. The activity id
 * is the entity id the remote gives it (a plain identifier, see
 * `isSafeId` in src/remote/parse.js).
 */
export const ACTIVITY_PREFIX = 'act:';
export const ACTIVITY_FEATURES = Object.freeze({
  /** Read only: 1 running, 0 stopped. */
  STATE: 'state',
  /** Push button: `activity.on`. */
  ON: 'on',
  /** Push button: `activity.off` (protective: never held back by a pause or the queue). */
  OFF: 'off',
});

export const ACTIONS = Object.freeze({
  RECONNECT: 'reconnect',
});

/** Paths of the Core API of the remote (pyUnfoldedCircleRemote 0.16.2, `remote.py`), under /api/. */
export const PATHS = Object.freeze({
  /** No API key needed: host name, MAC address, firmware. */
  VERSION: 'pub/version',
  SYSTEM: 'system',
  BATTERY: 'system/power/battery',
  POWER: 'system/power',
  ACTIVITIES: 'activities?limit=100',
  command: (entityId) => `entities/${encodeURIComponent(entityId)}/command`,
});

/** Activity commands (`cmd_id` of `PUT /api/entities/<id>/command`). */
export const COMMAND_IDS = Object.freeze({
  ON: 'activity.on',
  OFF: 'activity.off',
});

/** Power modes of the remote (`RemotePowerModes`). */
export const POWER_MODES = Object.freeze(['NORMAL', 'IDLE', 'LOW_POWER', 'SUSPEND']);

/** Reading intervals offered by the manifest, in seconds. */
export const POLL_INTERVALS = Object.freeze(['30', '60', '120', '300']);

export const TIMINGS = Object.freeze({
  /** One HTTP exchange outside of a command (the reference library allows 5 s). */
  httpTimeout: 5_000,
  /**
   * Gladys waits 5 s for the ack of a command: the whole command (the wait in
   * the per-remote queue included) gets this.
   */
  commandBudget: 3_500,
  /** After a command, the activities are read again this much later (once). */
  recheckDelay: 2_000,
  /** The identity of the remote (model, serial, firmware) is read again after this. */
  infoRefresh: 6 * 3_600_000,
  /**
   * A refused API key: tried again by itself after these delays (by index, the
   * last one repeating), never sooner; new settings or "Reconnect" try at once.
   */
  refusedRetry: [3_600_000, 6 * 3_600_000, 24 * 3_600_000],
  /** 429 or 5xx: a pause of this when the answer has no Retry-After, bounded by min and max. */
  pause429: 15 * 60_000,
  pause5xx: 5 * 60_000,
  pauseMin: 60_000,
  pauseMax: 6 * 3_600_000,
  /** The battery level is published again after this even when unchanged (history). */
  heartbeat: 30 * 60_000,
  /** Writes to /data are grouped. */
  persistDelay: 1_000,
});

export const LIMITS = Object.freeze({
  activities: 50,
  /** Largest answer read (the activity list is the big one). */
  responseBytes: 1024 * 1024,
  /** Largest answer read for the small endpoints. */
  smallBytes: 64 * 1024,
  /** Length of a published text, and of a name. */
  text: 200,
  name: 64,
});

/** What a text feature shows when nothing runs. */
export const NOTHING = '—';
