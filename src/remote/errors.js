// -----------------------------------------------------------------------------
// One error type for everything the remote can answer, with a kind the app
// decides on. Messages never carry the API key nor a header.
// -----------------------------------------------------------------------------

export const KINDS = Object.freeze({
  /** The remote refused the API key (401/403 of an authenticated path): only the user fixes it. */
  REFUSED: 'refused',
  /** No address or no API key in the configuration. */
  NO_CONFIG: 'no_config',
  /** Nothing reached the remote (connection refused, host unreachable, unknown name). */
  UNREACHABLE: 'unreachable',
  /**
   * The request may have reached the remote but no answer came in time (a
   * remote asleep, a link dropped mid-way): for a command, "sent, without
   * confirmation".
   */
  NO_ANSWER: 'no_answer',
  /**
   * The TLS handshake failed (a self-signed or wrong certificate on an
   * https:// address): no request went out.
   */
  TLS: 'tls',
  /** A reading of a previous client (new key, new address, "Reconnect"): dropped. */
  STALE: 'stale',
  /** 5xx. */
  UNAVAILABLE: 'unavailable',
  /** 429, with `retryAfterMs` when the answer said it. */
  RATE_LIMITED: 'rate_limited',
  /** Any other HTTP status. */
  HTTP: 'http',
  BAD_RESPONSE: 'bad_response',
  /** The request was not sent: the integration is paused (429 or 5xx earlier). */
  PAUSED: 'paused',
  /** A command had no time left: nothing was sent. */
  BUDGET: 'budget',
  /** A start command dropped from the queue by a later stop of the same activity. */
  CANCELLED: 'cancelled',
});

export class RemoteError extends Error {
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'RemoteError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}
