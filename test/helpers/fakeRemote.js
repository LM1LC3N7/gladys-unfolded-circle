// -----------------------------------------------------------------------------
// A fake Unfolded Circle remote behind `fetch`: the Core API paths the
// integration calls, answers shaped like the ones pyUnfoldedCircleRemote
// reads. The tests change its state (asleep, key revoked, 429…) and read the
// requests it received.
// -----------------------------------------------------------------------------

export const API_KEY = 'uc-test-key-0123456789';
export const SERIAL = 'UCR3SN0042';
export const MAC = 'a0:b1:c2:d3:e4:f5';
export const TV = 'uc.main.tv-activity';
export const MUSIC = 'uc.main.music-activity';

const failure = (code) => Object.assign(new TypeError('fetch failed'), { cause: { code } });

export function fakeRemote({ key = API_KEY } = {}) {
  const remote = {
    key,
    /** 'up', 'asleep' (nothing reaches it), 'dropped' (the link drops mid-way). */
    mode: 'up',
    /** path (without the query) -> forced status, for every method. */
    statuses: new Map(),
    /** path -> Retry-After header value. */
    retryAfter: new Map(),
    requests: [],
    version: { hostname: 'UC-Remote-3', address: MAC.toUpperCase(), os: '2.6.9' },
    system: {
      model_name: 'Remote 3',
      model_number: 'UCR3',
      serial_number: SERIAL,
      hw_revision: 'rev3',
    },
    battery: { capacity: 87, status: 'DISCHARGING', power_supply: false },
    power: { mode: 'NORMAL' },
    activities: [
      {
        entity_id: TV,
        name: { en_US: 'Watch TV', fr: 'Regarder la TV' },
        attributes: { state: 'OFF' },
      },
      { entity_id: MUSIC, name: { en_US: 'Music' }, attributes: { state: 'ON' } },
    ],
    /** Commands received: [entity_id, cmd_id]. */
    commands: [],
  };

  const json = (status, body, headers = {}) =>
    new Response(body === undefined ? '' : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });

  remote.fetch = async (url, init = {}) => {
    const target = new URL(url);
    const path = target.pathname.replace(/^\/api\//, '');
    const headers = Object.fromEntries(
      Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
    );
    const body = init.body ? JSON.parse(init.body) : undefined;
    remote.requests.push({ method: init.method ?? 'GET', url, path, headers, body, init });
    if (remote.mode === 'asleep') {
      throw failure('EHOSTUNREACH');
    }
    if (remote.mode === 'dropped') {
      throw failure('ECONNRESET');
    }
    const forced = remote.statuses.get(path);
    if (forced) {
      const extra = remote.retryAfter.has(path)
        ? { 'retry-after': remote.retryAfter.get(path) }
        : {};
      return json(forced, { code: 'ERROR', message: 'forced' }, extra);
    }
    if (path === 'pub/version') {
      return json(200, remote.version);
    }
    if (headers.authorization !== `Bearer ${remote.key}`) {
      return json(401, { code: 'UNAUTHORIZED', message: 'Unauthorized' });
    }
    if (path === 'system') {
      return json(200, remote.system);
    }
    if (path === 'system/power/battery') {
      return json(200, remote.battery);
    }
    if (path === 'system/power') {
      return json(200, remote.power);
    }
    if (path === 'activities') {
      return json(200, remote.activities);
    }
    const command = path.match(/^entities\/([^/]+)\/command$/);
    if (command && init.method === 'PUT') {
      const id = decodeURIComponent(command[1]);
      const activity = remote.activities.find((a) => a.entity_id === id);
      if (!activity) {
        return json(404, { code: 'NOT_FOUND', message: 'Entity not found' });
      }
      remote.commands.push([body.entity_id, body.cmd_id]);
      activity.attributes.state = body.cmd_id === 'activity.on' ? 'ON' : 'OFF';
      return json(200, { code: 'OK' });
    }
    return json(404, { code: 'NOT_FOUND', message: 'Not found' });
  };

  /** The readings (GET) received, by path. */
  remote.reads = (p) => remote.requests.filter((r) => r.method === 'GET' && r.path === p).length;
  return remote;
}
