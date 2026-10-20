// -----------------------------------------------------------------------------
// The configuration: the manifest `config_schema` values, normalized so the
// rest of the code never deals with strings typed in a form.
// -----------------------------------------------------------------------------

import { scryptSync } from 'node:crypto';
import { POLL_INTERVALS } from './constants.js';
import { parseBaseUrl } from './remote/parse.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULT_CONFIG = {
  poll_interval: '60',
  language: 'fr',
};

export function normalizeConfig(raw = {}, salt = undefined) {
  const c = {
    ...DEFAULT_CONFIG,
    ...Object.fromEntries(Object.entries(raw ?? {}).filter(([, v]) => v != null)),
  };
  const host = typeof c.host === 'string' ? c.host.trim() : '';
  const baseUrl = parseBaseUrl(host);
  // An API key is a printable token: anything else (a pasted line break, a
  // huge value) is treated as missing rather than sent.
  const key = typeof c.api_key === 'string' ? c.api_key.trim() : '';
  const apiKey = /^[\x21-\x7e]{1,512}$/.test(key) ? key : '';
  const interval = POLL_INTERVALS.includes(String(c.poll_interval))
    ? String(c.poll_interval)
    : DEFAULT_CONFIG.poll_interval;
  return {
    baseUrl,
    /** A host was typed but is not a plain address (said in the status). */
    invalidHost: host !== '' && baseUrl === undefined,
    apiKey,
    ready: baseUrl !== undefined && apiKey !== '',
    pollMs: Number(interval) * 1000,
    language: c.language === 'en' ? 'en' : 'fr',
    /** Set once the salt of /data is known (`credentialDigest`). */
    fingerprint: salt && baseUrl ? credentialDigest(baseUrl, apiKey, salt) : undefined,
  };
}

let memo = { key: undefined, digest: undefined };

/**
 * A digest of the address and API key: a refusal is kept against it, so only
 * a new key, a new address or the "Reconnect" button try again at once.
 * scrypt with a random salt kept beside it in /data: the digest alone is
 * written there, never the key, and it cannot be checked against guesses
 * cheaply.
 */
export function credentialDigest(baseUrl, apiKey, salt) {
  const key = JSON.stringify([baseUrl, apiKey]);
  const cacheKey = `${salt}\n${key}`;
  if (memo.key !== cacheKey) {
    memo = {
      key: cacheKey,
      digest: scryptSync(key, Buffer.from(salt, 'hex'), 32, { N: 16384, r: 8, p: 1 }).toString(
        'hex',
      ),
    };
  }
  return memo.digest;
}
