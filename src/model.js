// -----------------------------------------------------------------------------
// The remote -> a Gladys device and its states (pure). One device per remote,
// keyed by its serial number (else its MAC address).
//
// No switch, nothing an "everything on / off" (voice assistants, MCP, scenes
// `switch.*`) could turn into a command: the state of an activity is read only
// (`unknown/binary`), starting and stopping it are two push buttons. Units:
// only `percent` for the battery level, the one the core lists for the
// battery category; the charging flag (`battery/charging`) carries none.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import {
  ACTIVITY_FEATURES,
  ACTIVITY_PREFIX,
  DEVICE_TYPE,
  FEATURES,
  LIMITS,
  NOTHING,
} from './constants.js';
import { isSafeId } from './remote/parse.js';

const NAMES = {
  [FEATURES.BATTERY]: { en: 'Battery', fr: 'Batterie' },
  [FEATURES.CHARGING]: { en: 'Charging', fr: 'En charge' },
  [FEATURES.ONLINE]: { en: 'Reachable', fr: 'Joignable' },
  [FEATURES.POWER_MODE]: { en: 'Power mode', fr: "Mode d'alimentation" },
  [FEATURES.ACTIVITY]: { en: 'Current activity', fr: 'Activité en cours' },
};

const ACTIVITY_NAMES = {
  [ACTIVITY_FEATURES.STATE]: { en: (n) => `${n}: running`, fr: (n) => `${n} : en cours` },
  [ACTIVITY_FEATURES.ON]: { en: (n) => `Start ${n}`, fr: (n) => `Démarrer ${n}` },
  [ACTIVITY_FEATURES.OFF]: { en: (n) => `Stop ${n}`, fr: (n) => `Arrêter ${n}` },
};

/** What the power mode text shows. */
export const POWER_MODE_TEXT = {
  NORMAL: { en: 'Normal', fr: 'Normal' },
  IDLE: { en: 'Idle', fr: 'Inactive' },
  LOW_POWER: { en: 'Low power', fr: 'Économie d’énergie' },
  SUSPEND: { en: 'Asleep', fr: 'En veille' },
};

const readOnly = { read_only: true, has_feedback: false };
const button = { category: C.BUTTON, type: T.BUTTON.PUSH, min: 0, max: 1 };

/** The definitions of the remote's own features, by frozen key, in the order they are published. */
export const FEATURE_SPECS = Object.freeze({
  [FEATURES.BATTERY]: {
    category: C.BATTERY,
    type: T.BATTERY.INTEGER,
    unit: U.PERCENT,
    min: 0,
    max: 100,
    keep_history: true,
    ...readOnly,
  },
  [FEATURES.CHARGING]: {
    category: C.BATTERY,
    type: T.BATTERY.CHARGING,
    min: 0,
    max: 1,
    ...readOnly,
  },
  [FEATURES.ONLINE]: {
    category: C.UNKNOWN,
    type: T.SENSOR.BINARY,
    min: 0,
    max: 1,
    ...readOnly,
  },
  [FEATURES.POWER_MODE]: { category: C.TEXT, type: T.TEXT.TEXT, min: 0, max: 0, ...readOnly },
  [FEATURES.ACTIVITY]: { category: C.TEXT, type: T.TEXT.TEXT, min: 0, max: 0, ...readOnly },
});

const ACTIVITY_SPECS = Object.freeze({
  [ACTIVITY_FEATURES.STATE]: {
    category: C.UNKNOWN,
    type: T.SENSOR.BINARY,
    min: 0,
    max: 1,
    keep_history: true,
    ...readOnly,
  },
  [ACTIVITY_FEATURES.ON]: button,
  [ACTIVITY_FEATURES.OFF]: button,
});

/** The feature key of one feature of an activity. */
export const activityKey = (activityId, suffix) => `${ACTIVITY_PREFIX}${activityId}:${suffix}`;

/**
 * What a feature key targets: { kind: 'activity', activityId, suffix } or
 * { kind: 'remote', key }, or undefined.
 */
export function parseFeatureKey(key) {
  if (typeof key !== 'string') {
    return undefined;
  }
  if (key.startsWith(ACTIVITY_PREFIX)) {
    const rest = key.slice(ACTIVITY_PREFIX.length);
    const index = rest.lastIndexOf(':');
    const activityId = rest.slice(0, index);
    const suffix = rest.slice(index + 1);
    return index > 0 && isSafeId(activityId) && Object.values(ACTIVITY_FEATURES).includes(suffix)
      ? { kind: 'activity', activityId, suffix }
      : undefined;
  }
  return Object.values(FEATURES).includes(key) ? { kind: 'remote', key } : undefined;
}

export const deviceName = (remote) => remote?.name || remote?.model || 'Unfolded Circle Remote';

/**
 * The Gladys device of the remote. `created` (the device as Gladys has it,
 * from `gladys.devices`) adds back any feature of the created device this list
 * would not have (an activity deleted on the remote included): a device
 * published again never loses a feature.
 */
export function buildDevice(gladys, remote, activities, language = 'fr', created = undefined) {
  const ids = gladys.externalIds(DEVICE_TYPE, remote.id);
  const feature = (key, name, spec) => ({
    name: name.slice(0, LIMITS.text),
    external_id: ids.feature(key),
    read_only: false,
    has_feedback: false,
    keep_history: false,
    ...spec,
  });
  const features = Object.entries(FEATURE_SPECS).map(([key, spec]) =>
    feature(key, NAMES[key][language] ?? NAMES[key].en, spec),
  );
  for (const activity of activities) {
    for (const [suffix, spec] of Object.entries(ACTIVITY_SPECS)) {
      const names = ACTIVITY_NAMES[suffix];
      features.push(
        feature(
          activityKey(activity.id, suffix),
          (names[language] ?? names.en)(activity.name),
          spec,
        ),
      );
    }
  }
  const known = new Set(features.map((f) => f.external_id));
  for (const f of Array.isArray(created?.features) ? created.features : []) {
    if (f && typeof f.external_id === 'string' && !known.has(f.external_id)) {
      known.add(f.external_id);
      features.push({ ...f });
    }
  }
  return {
    name: deviceName(remote),
    external_id: ids.device,
    should_poll: false,
    features,
  };
}

/** The feature key of a feature external id of `device`, or undefined. */
export function featureKey(deviceExternalId, featureExternalId) {
  const prefix = `${deviceExternalId}:`;
  return String(featureExternalId ?? '').startsWith(prefix)
    ? String(featureExternalId).slice(prefix.length)
    : undefined;
}

/**
 * The states of the remote from the last reading `view`:
 * { online, battery?, charging?, powerMode?, activities?: [{ id, name, state }] }.
 * Offline: only `online` 0 (the other values are not known any more, the
 * last ones stay shown). A value missing from the reading publishes nothing.
 */
export function stateList(gladys, remote, view, language = 'fr') {
  if (!view || typeof view.online !== 'boolean') {
    return [];
  }
  const ids = gladys.externalIds(DEVICE_TYPE, remote.id);
  const id = (key) => ids.feature(key);
  const states = [{ device_feature_external_id: id(FEATURES.ONLINE), state: view.online ? 1 : 0 }];
  if (!view.online) {
    return states;
  }
  if (Number.isInteger(view.battery)) {
    states.push({ device_feature_external_id: id(FEATURES.BATTERY), state: view.battery });
  }
  if (typeof view.charging === 'boolean') {
    states.push({
      device_feature_external_id: id(FEATURES.CHARGING),
      state: view.charging ? 1 : 0,
    });
  }
  if (view.powerMode && POWER_MODE_TEXT[view.powerMode]) {
    states.push({
      device_feature_external_id: id(FEATURES.POWER_MODE),
      text: POWER_MODE_TEXT[view.powerMode][language] ?? POWER_MODE_TEXT[view.powerMode].en,
    });
  }
  if (Array.isArray(view.activities)) {
    const running = view.activities.filter((a) => a.state === 'ON').map((a) => a.name);
    states.push({
      device_feature_external_id: id(FEATURES.ACTIVITY),
      text: running.length ? running.join(', ').slice(0, LIMITS.text) : NOTHING,
    });
    for (const activity of view.activities) {
      if (activity.state === 'ON' || activity.state === 'OFF') {
        states.push({
          device_feature_external_id: id(activityKey(activity.id, ACTIVITY_FEATURES.STATE)),
          state: activity.state === 'ON' ? 1 : 0,
        });
      }
    }
  }
  return states;
}
