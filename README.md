# gladys-unfolded-circle

[Gladys Assistant](https://gladysassistant.com) external integration for the
**Unfolded Circle Remote Two** and **Remote 3**, through the local Core API of
the remote (REST, API key): battery level, charging, reachability, power
mode, the activities running, and for each activity a read-only state with
start and stop push buttons. No cloud. Unofficial, not affiliated with
Unfolded Circle.

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

> **Work in progress (milestone 1).** Never tested with a real device: tested
> against a simulated remote only.

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (RemoteApp)
                                   ├─ src/remote/api.js    http://<remote>/api/… (Authorization: Bearer <key>)
                                   ├─ src/remote/http.js   fetch, timeout, size cap, failures sorted
                                   ├─ src/remote/parse.js  readers of the answers (pure)
                                   ├─ src/model.js         -> Gladys device and states (pure)
                                   └─ src/store.js         /data/unfolded-circle.json
```

- **Readings** by our own timer, every 30 s to 5 min: `GET activities`
  (main), `system/power/battery` and `system/power` (secondary), and the
  identity (`pub/version` without the key, `system`) at start and every 6 h.
  An error never makes the readings faster.
- **Device**: one per remote, external id from its serial number (else its
  MAC address), kept in `/data`. Features: battery (`battery/integer`, %),
  charging (`battery/charging`), reachable, power mode and current activity
  (texts), and per activity `act:<id>:state` (read only) with `act:<id>:on`
  and `act:<id>:off` (`button/push`). No switch.
- **Commands**: `PUT entities/<id>/command` with `activity.on` /
  `activity.off`, within 3.5 s of the request of Gladys. Starts are queued;
  a stop goes at once (also during a pause, one try) and drops the queued
  starts of the same activity. Nothing reached the remote: "nothing sent";
  no answer in time: "sent, without confirmation", read again 2 s later.
- **Refused key** (401/403): a stop kept in `/data` against a scrypt digest of
  the address and key (never the key), tried again by itself after 1 h, 6 h,
  then every 24 h; a new key or "Reconnect" tries at once.
- **429 / 5xx**: a pause of 1 min to 6 h (Retry-After, else 15 min / 5 min),
  kept in `/data` and read back bounded.
- **Status and Discovery** are published again at every `connected`; a
  device published again keeps the features of the created one.

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit
npx github:GladysAssistant/integration-store .  # store admission checks
node scripts/cover.mjs cover.png                # regenerate the cover
```

`test/helpers/` holds a fake remote behind `fetch` and a clock moved by hand.

## Credits

- [jackjpowell/py-unfolded-circle](https://github.com/jackjpowell/py-unfolded-circle)
  (pyUnfoldedCircleRemote, MIT), 0.16.2, the library of the Home Assistant
  integration: read as the reference and ported to JavaScript (no Python runs
  here).

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release. The
`gladys-assistant-integration` topic lists the repository in the Gladys store
(added at the first real release).

## License

Apache-2.0 (see [LICENSE](LICENSE)); the logic ported from
pyUnfoldedCircleRemote (MIT) is listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Unfolded Circle, Remote Two
and Remote 3 are trademarks of their owner; this project is not affiliated
with Unfolded Circle.
