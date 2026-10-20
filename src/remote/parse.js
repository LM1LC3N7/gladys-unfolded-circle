// -----------------------------------------------------------------------------
// Readers of the remote's answers (pure). Everything comes from the network:
// each field is checked for its type and bounded, ids must be plain
// identifiers (never `__proto__`, `constructor` or `prototype`), and nothing
// is ever merged into an object as is.
// -----------------------------------------------------------------------------

import { LIMITS, POWER_MODES } from '../constants.js';

const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
const SAFE_ID = /^[A-Za-z0-9._-]{1,80}$/;

/** A plain identifier usable as a key and inside an external id. */
export const isSafeId = (id) => typeof id === 'string' && SAFE_ID.test(id) && !FORBIDDEN.has(id);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** A short single-line text: control characters dropped, trimmed, cut at `max`. */
export function cleanText(value, max = LIMITS.text) {
  if (typeof value !== 'string') {
    return undefined;
  }
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return text === '' ? undefined : text.slice(0, max);
}

/**
 * The base URL of the Core API from what the user typed: `192.168.1.20`,
 * `remote.local:8080`, `http://192.168.1.20` or `.../api`. Undefined when it
 * is not a plain host (credentials, query, another path, another scheme).
 */
export function parseBaseUrl(input) {
  const text = typeof input === 'string' ? input.trim() : '';
  if (text === '' || text.length > 255 || /\s/.test(text)) {
    return undefined;
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return undefined;
  }
  if (url.username || url.password || url.search || url.hash || !url.hostname) {
    return undefined;
  }
  if (!['', '/', '/api', '/api/'].includes(url.pathname)) {
    return undefined;
  }
  return `${url.protocol}//${url.host}/api/`;
}

/**
 * A text of the remote in the wanted language: a plain string, or an object
 * keyed by locale (`en_US`, `fr`, `de_CH`…), as `get_text_for_locale` reads it.
 */
export function pickText(value, language = 'en') {
  if (typeof value === 'string') {
    return cleanText(value, LIMITS.name);
  }
  if (!isObject(value)) {
    return undefined;
  }
  const entries = Object.entries(value)
    .slice(0, 50)
    .filter(([k, v]) => typeof k === 'string' && typeof v === 'string' && cleanText(v));
  const find = (test) => entries.find(([k]) => test(k.toLowerCase()))?.[1];
  const text =
    find((k) => k === language) ??
    find((k) => k.startsWith(`${language}_`) || k.startsWith(`${language}-`)) ??
    find((k) => k === 'en_us') ??
    find((k) => k === 'en' || k.startsWith('en_')) ??
    entries[0]?.[1];
  return cleanText(text, LIMITS.name);
}

/** `GET /api/pub/version`: { hostname?, mac?, firmware? }. */
export function parseVersion(json) {
  if (!isObject(json)) {
    return undefined;
  }
  const mac = typeof json.address === 'string' ? json.address.trim().toLowerCase() : '';
  return {
    hostname: cleanText(json.hostname, LIMITS.name),
    mac: /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/.test(mac) ? mac.replace(/-/g, ':') : undefined,
    firmware: cleanText(json.os, 32),
  };
}

/** `GET /api/system`: { model?, modelNumber?, serial?, revision? }. */
export function parseSystem(json) {
  if (!isObject(json)) {
    return undefined;
  }
  const serial = typeof json.serial_number === 'string' ? json.serial_number.trim() : '';
  return {
    model: cleanText(json.model_name, LIMITS.name),
    modelNumber: cleanText(json.model_number, 32),
    serial: isSafeId(serial) ? serial : undefined,
    revision: cleanText(json.hw_revision, 32),
  };
}

/** `GET /api/system/power/battery`: { level?, charging? }. */
export function parseBattery(json) {
  if (!isObject(json)) {
    return undefined;
  }
  const level =
    typeof json.capacity === 'number' && Number.isFinite(json.capacity)
      ? Math.round(Math.min(100, Math.max(0, json.capacity)))
      : undefined;
  const charging = typeof json.power_supply === 'boolean' ? json.power_supply : undefined;
  return { level, charging };
}

/** `GET /api/system/power`: one of POWER_MODES, or undefined. */
export function parsePower(json) {
  return isObject(json) && POWER_MODES.includes(json.mode) ? json.mode : undefined;
}

/** Activity states the remote reports; anything else is "unknown" (no state published). */
const ACTIVITY_STATES = new Set(['ON', 'OFF']);

/**
 * `GET /api/activities`: [{ id, name, state }], at most LIMITS.activities,
 * each id once. `state` is 'ON', 'OFF' or undefined (a sequence running, an
 * error, a state this code does not know).
 */
export function parseActivities(json, language = 'en') {
  if (!Array.isArray(json)) {
    return undefined;
  }
  const seen = new Set();
  const list = [];
  for (const entry of json) {
    if (list.length >= LIMITS.activities) {
      break;
    }
    if (!isObject(entry) || !isSafeId(entry.entity_id) || seen.has(entry.entity_id)) {
      continue;
    }
    seen.add(entry.entity_id);
    const state = isObject(entry.attributes) ? entry.attributes.state : undefined;
    list.push({
      id: entry.entity_id,
      name: pickText(entry.name, language) ?? entry.entity_id,
      state: ACTIVITY_STATES.has(state) ? state : undefined,
    });
  }
  return list;
}

/** A JSON body, or undefined (never throws). */
export function parseJson(text) {
  if (typeof text !== 'string' || text === '') {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
