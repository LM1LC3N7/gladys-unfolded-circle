# TODO — Unfolded Circle Remote v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`
  (Node 22 and 24), `npm audit --omit=dev`,
  `npx github:GladysAssistant/integration-store .`, then update README,
  `docs/en.md`, `docs/fr.md`, `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only.

## Status

- [x] **Milestone 1 — local API, activities, buttons** (2026-10-20): the
      Core API paths of pyUnfoldedCircleRemote 0.16.2, API key, one device
      per remote (battery, charging, reachable, power mode, current activity,
      per activity a state and start / stop buttons), readings by our own
      timer, refused key and 429/5xx pauses kept in `/data`; docs en/fr.
      Tested against a fake remote and a fake clock only, never with a real
      device. The store validator was not run by the dev agent (it cannot):
      to run in the real terminal before publishing.
- [ ] **Milestone 2 — real remotes** (testers with a Remote Two or Remote 3):
      record real answers as fixtures, fix what differs. To check first:
  - the API key creation with the PIN (`POST /api/auth/api_keys`, scope
    `admin`): whether a narrower scope is enough for reading and activity
    commands, and whether the recent web configurator creates keys itself;
  - the status of `PUT /api/entities/<id>/command` (200 or 202) and how long
    an activity with a long sequence takes to answer: if the remote answers
    only at the end of the sequence, the 3.5 s budget gives "sent, without
    confirmation" for every slow activity (then answer at once and follow the
    state through the readings);
  - the activity states besides `ON` / `OFF` (a sequence running, an error):
    they publish nothing today;
  - what a sleeping remote does: no answer at all (assumed), or a 503
    (treated as a 5xx pause of 5 minutes, which would then be too long);
  - whether readings every 30 s keep the remote awake or drain its battery;
  - HTTPS on the Remote 3 (a self-signed certificate would fail: plain HTTP
    is documented).
- [ ] **Milestone 3 — more**: Wake-on-LAN of a sleeping remote before a
      command (needs the MAC and broadcast from the container network),
      the websocket events (`/ws`) instead of readings, activity groups, the
      ambient light sensor, the docks, the media players of an activity.
- [ ] **Milestone 4 — first release**: Docker image build check, Release
      workflow, topic, then the store validator once the image is published.

## Decisions

- Forum: no dedicated topic, no post from this module's work; one recap per
  wave in /t/10385, posted by the main session.
- Reuse: pyUnfoldedCircleRemote 0.16.2 (jackjpowell/py-unfolded-circle,
  commit 7d55fb3) is Python, so its paths, headers, commands and fields are
  ported to JavaScript (`src/constants.js`, `src/remote/`). Licence checked in
  its `LICENSE` file: the MIT text with the copyright line of the packaging
  template ("Copyright (c) 2018 The Python Packaging Authority"), not its
  author's; `pyproject.toml` declares MIT and Jack Powell as author. Not GPL:
  usable. The file is reproduced as is in `THIRD_PARTY_NOTICES.md` (copied
  into the image) with that remark. Neighbour module: LM1LC3N7/gladys-lg-horizon
  (structure of app, store, config, i18n, tests).
- Local only (`transports: ["local"]`): the Core API of the remote on the
  user's network, plain HTTP by default (HTTPS accepted when typed). No cloud,
  no Bluetooth, no imitation of the web configurator: the API key path is the
  documented one.
- API key in `Authorization: Bearer` only, never in a URL; no redirect
  followed (`redirect: 'manual'`), so it never goes to another host. The API
  client keeps it in a non-enumerable property; messages and logs carry
  statuses only. Kept by Gladys in its database (a `secret` field, never
  shown again); never written to `/data`, which only holds a scrypt digest
  (random salt) of the address and key. The docs describe it as "kept by
  Gladys in its database, never shown again", never otherwise.
- The PIN is never asked: storing it would let the integration create keys.
  The docs give the `curl` request (from the reference's `create_api_key`).
- Activities as **push buttons** (`button/push` "Start" and "Stop"), the
  state read only (`unknown/binary`), the running names as a text: nothing an
  "everything off" (voice assistants, MCP, scenes `switch.*`) could take as a
  command. Not a sensitive command in the sense of the pipeline rules
  (activities drive TVs and amplifiers): enabled without an option.
- `activity.on` / `activity.off` are idempotent (not toggles): sent as
  asked, no guard. Starts are serialized; a stop is protective: sent at once,
  never behind the queue, also during a 429/5xx pause (one try), and it drops
  the starts of the same activity still queued. Residual race noted: a start
  already in flight when a stop is pressed may land after it at the remote;
  the next reading shows the result.
- Command budget 3.5 s from the request of Gladys (queue included); nothing is
  sent with less than 50 ms left. Network failures are sorted: nothing
  reached the remote (ECONNREFUSED, EHOSTUNREACH, ENOTFOUND…) → "nothing
  sent"; a timeout or a dropped link → "sent, without confirmation" and a
  reading 2 s later. The ack never waits for a publication to Gladys.
- Readings by a named timer (not the Gladys poll scheduler, which stops at
  1 min): activities (main), battery and power mode (secondary: their
  failure only leaves their values out), the identity at start and every
  6 h. Interval 30 s, 1, 2 or 5 min; an error never makes it faster; a
  reading after a command is a single one.
- Refused key (401/403 of an authenticated path; `pub/version` has no key):
  stop kept in `/data` against the digest, automatic tries after 1 h, 6 h,
  then every 24 h (never a loop), at once with a new key or address, and one
  try with "Reconnect".
- 429 and 5xx (readings), 429 and 503 (commands): a pause of Retry-After,
  else 15 min (429) / 5 min (5xx), bounded 1 min to 6 h, kept in `/data` and
  bounded when read back; nothing read and no start during it.
- A reconnection to Gladys (`connected`) keeps the client, the pause and the
  refusal; it publishes the status, the Discovery and the states again
  (caches cleared, `forgetPublishedStates`).
- External id: `gladys.externalIds('remote', <serial number>)`, else the MAC
  address without colons; once chosen it is kept in `/data` and reused while
  the remote answers with the same serial or MAC. Activity features:
  `act:<entity id>:state|on|off`, the entity id being a plain identifier
  (`[A-Za-z0-9._-]`, never `__proto__`, `constructor`, `prototype`).
- Every publication of the device starts from the device created in Gladys
  (`gladys.devices`) and adds back its features: an activity deleted on the
  remote keeps its features (its buttons answer that it no longer exists).
- Units: `percent` for the battery level only (the one the core lists for
  `battery`); `battery/charging` carries none. No energy index, no scene
  event.
- Answers capped (1 MB for the activities, 64 KB otherwise), parsed once with
  `JSON.parse`, every field checked and copied, tables without prototype; 50
  activities at most; names cut at 64 characters.

### Review fixes (2026-10-21, review 1)

- B1: a reading in flight is shared only within the same client
  (generation); `read()` checks the generation after every request and
  writes nothing for an old client. A new key, address or "Reconnect" during
  a reading starts its own reading at once.
- I1: on a secondary path (battery, power mode, identity refresh) only a
  refused key or a 429 is decisive; a 5xx only leaves its values out (the
  identity is then kept and asked again in 6 h). A 5xx of the activities, or
  of the identity at the first reading, still pauses.
- I2: a failed command acks at once; the pause and the status go in the
  background.
- I2b: a 401/403 of a command does not block: it asks for a reading, which
  blocks only if the key is really refused (message "refused by the
  remote"). A stop is tried once even while blocked; its 401 does not make the
  wait longer.
- M1/M4: readings after commands use their own timer (`recheck`), one
  waiting at most, spaced 10 s; one asked during a reading in flight runs
  after it.
- M2: the activities are read first; battery and power mode only when they
  answered (a remote asleep: one request per reading). Battery question put
  to testers in the docs.
- M3: a stop is accepted for any safe activity id of the created device, even
  one `/data` does not list; a start still needs a listed activity.
- M5: TLS and certificate codes (`*CERT*`, `ERR_TLS_*`, `ERR_SSL_*`) are their
  own kind: status "certificate refused, use http://", commands "nothing
  sent".

- Version 0.1.0 in `package.json`, `package-lock.json`, the manifest and the
  `docker_image` tag, set by hand at milestone 1: the one exception to
  "versions belong to the Release workflow", because the template's 1.0.0 and
  its image were someone else's. The first patch release gives 0.1.1.
