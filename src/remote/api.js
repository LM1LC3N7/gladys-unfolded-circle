// -----------------------------------------------------------------------------
// The Core API of the remote (REST, `http://<remote>/api/`), as
// pyUnfoldedCircleRemote 0.16.2 calls it: an API key in
// `Authorization: Bearer`, JSON answers. Statuses are sorted here into the
// kinds the app decides on (src/remote/errors.js). The key is only ever put in
// that header: never in a URL, a message or a log.
// -----------------------------------------------------------------------------

import { COMMAND_IDS, LIMITS, PATHS, TIMINGS } from '../constants.js';
import { KINDS, RemoteError } from './errors.js';
import { httpRequest, retryAfterMs } from './http.js';
import { parseJson } from './parse.js';

export class RemoteApi {
  constructor({
    baseUrl,
    apiKey,
    request = httpRequest,
    fetchImpl,
    now = Date.now,
    timings = TIMINGS,
    pausedUntil = () => 0,
  }) {
    this.baseUrl = baseUrl;
    // Not enumerable: a dump of the object never shows it.
    Object.defineProperty(this, 'apiKey', { value: apiKey, enumerable: false });
    this.request = request;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.timings = timings;
    this.pausedUntil = pausedUntil;
  }

  url(path) {
    return new URL(path, this.baseUrl).toString();
  }

  /**
   * One call. `protective`: sent even during a pause (a stop, one try only).
   * Resolves the JSON body (undefined when empty).
   */
  async call(
    path,
    {
      method = 'GET',
      body,
      auth = true,
      protective = false,
      timeoutMs = this.timings.httpTimeout,
      maxBytes = LIMITS.smallBytes,
    } = {},
  ) {
    if (!protective && this.pausedUntil() > this.now()) {
      throw new RemoteError(KINDS.PAUSED, 'Paused after a 429 or 5xx answer');
    }
    const headers = { Accept: 'application/json' };
    if (auth) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    const response = await this.request(
      this.url(path),
      {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        timeoutMs,
        maxBytes,
      },
      this.fetchImpl,
    );
    const { status } = response;
    if (status >= 200 && status < 300) {
      return parseJson(response.body);
    }
    const retry = retryAfterMs(response.headers?.get?.('retry-after'), this.now());
    if (status === 429) {
      throw new RemoteError(KINDS.RATE_LIMITED, 'The remote asked to slow down (429)', {
        status,
        retryAfterMs: retry,
      });
    }
    if (status >= 500) {
      throw new RemoteError(KINDS.UNAVAILABLE, `The remote answered ${status}`, {
        status,
        retryAfterMs: retry,
      });
    }
    if (auth && (status === 401 || status === 403)) {
      throw new RemoteError(KINDS.REFUSED, `The remote refused the API key (${status})`, {
        status,
      });
    }
    throw new RemoteError(KINDS.HTTP, `The remote answered ${status}`, { status });
  }

  /** The JSON of a GET, which must be there. */
  async read(path, options) {
    const json = await this.call(path, options);
    if (json === undefined) {
      throw new RemoteError(KINDS.BAD_RESPONSE, `No JSON answer for ${path.split('?')[0]}`);
    }
    return json;
  }

  version() {
    return this.read(PATHS.VERSION, { auth: false });
  }

  system() {
    return this.read(PATHS.SYSTEM);
  }

  battery() {
    return this.read(PATHS.BATTERY);
  }

  power() {
    return this.read(PATHS.POWER);
  }

  activities() {
    return this.read(PATHS.ACTIVITIES, { maxBytes: LIMITS.responseBytes });
  }

  /** `activity.on` / `activity.off` of one activity, within `timeoutMs`. */
  activityCommand(activityId, on, { timeoutMs, protective = false } = {}) {
    return this.call(PATHS.command(activityId), {
      method: 'PUT',
      body: { entity_id: activityId, cmd_id: on ? COMMAND_IDS.ON : COMMAND_IDS.OFF },
      timeoutMs,
      protective,
    });
  }
}
