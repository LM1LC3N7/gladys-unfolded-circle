// -----------------------------------------------------------------------------
// The only HTTP access: `fetch` with an explicit timer (not
// AbortSignal.timeout, whose timer does not keep the process alive), a capped
// answer size, no redirect followed (the API key never goes anywhere else),
// and the network failures sorted into "nothing reached the remote" and "no
// answer in time".
// -----------------------------------------------------------------------------

import { KINDS, RemoteError } from './errors.js';

/** Codes of a request that never reached the remote. */
const UNREACHABLE_CODES = new Set([
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EHOSTDOWN',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EADDRNOTAVAIL',
  'UND_ERR_CONNECT_TIMEOUT',
]);

/**
 * A certificate or TLS handshake failure (`DEPTH_ZERO_SELF_SIGNED_CERT`,
 * `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, `CERT_HAS_EXPIRED`, `ERR_TLS_CERT_ALTNAME_INVALID`,
 * `ERR_SSL_…`): the remote was reached but no request went out.
 */
export const isTlsCode = (code) =>
  typeof code === 'string' &&
  (/CERT|SELF_SIGNED|^ERR_TLS_|^ERR_SSL_/.test(code) ||
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    code === 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY');

/** Parses a Retry-After header (seconds or HTTP date) into milliseconds. */
export function retryAfterMs(value, now = Date.now()) {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }
  const text = String(value).trim();
  if (/^\d{1,9}$/.test(text)) {
    return Number(text) * 1000;
  }
  const date = Date.parse(text);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

/** Reads at most `maxBytes` of a body; a longer answer is an error. */
async function readCapped(response, maxBytes) {
  if (!response.body) {
    return '';
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new RemoteError(KINDS.BAD_RESPONSE, `Answer larger than ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

/** The code of a fetch failure (undici puts it on `cause`, sometimes one level deeper). */
const failureCode = (err) => err?.cause?.code ?? err?.cause?.cause?.code ?? err?.code;

/**
 * One HTTP exchange. Resolves `{ status, headers, body }` for any status;
 * rejects with a RemoteError UNREACHABLE (nothing reached the remote) or
 * NO_ANSWER (timeout, connection dropped: it may have reached it).
 */
export async function httpRequest(
  url,
  { method = 'GET', headers = {}, body, timeoutMs = 5_000, maxBytes = 64 * 1024 } = {},
  fetchImpl = globalThis.fetch,
) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(
    () => {
      timedOut = true;
      controller.abort();
    },
    Math.max(1, timeoutMs),
  );
  try {
    const response = await fetchImpl(url, {
      method,
      headers,
      body,
      redirect: 'manual',
      signal: controller.signal,
    });
    const text = await readCapped(response, maxBytes);
    return { status: response.status, headers: response.headers, body: text };
  } catch (err) {
    if (err instanceof RemoteError) {
      throw err;
    }
    if (timedOut) {
      throw new RemoteError(KINDS.NO_ANSWER, `No answer within ${timeoutMs} ms`);
    }
    const code = failureCode(err);
    if (isTlsCode(code)) {
      throw new RemoteError(KINDS.TLS, `TLS certificate refused (${code})`);
    }
    if (UNREACHABLE_CODES.has(code)) {
      throw new RemoteError(KINDS.UNREACHABLE, `Remote unreachable (${code})`);
    }
    throw new RemoteError(KINDS.NO_ANSWER, `Network error (${code ?? err?.name ?? 'unknown'})`);
  } finally {
    clearTimeout(timer);
  }
}
