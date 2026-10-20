# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Unfolded Circle Remote Two and Remote 3, through the local Core API of the
  remote (REST, API key): a JavaScript port of pyUnfoldedCircleRemote 0.16.2
  (MIT). No cloud.
- One device per remote, keyed by its serial number (else its MAC address):
  battery level, charging, reachable, power mode, the activities running,
  and per activity a read-only state with start and stop push buttons (no
  switch).
- Readings by our own timer, every 30 s to 5 min (1 min by default), never
  faster after an error; a remote asleep shows "Reachable" 0 and keeps its
  last values.
- A stop goes at once (also during a pause, one try) and cancels the queued
  starts of the same activity; a command answers within 3.5 s, "sent, without
  confirmation" when the remote did not answer in time.
- A refused API key stops the integration, across restarts too; it tries
  again by itself after 1 h, 6 h, then every 24 h, and at once with a new key
  or the "Reconnect" button.
- 429 and 5xx pauses (1 minute to 6 hours) kept across restarts.
- Status and Discovery published again at every connection to Gladys; a
  device published again keeps every feature of the created one.
- Feature names in French or English.
- `LICENSE` (Apache-2.0) and `THIRD_PARTY_NOTICES.md` (pyUnfoldedCircleRemote,
  MIT), copied into the image.

### Fixed

- A new API key, a new address or "Reconnect" during a reading no longer
  leaves the integration without any reading: the new client reads at once,
  and nothing of the old reading is kept.
- A 5xx of the battery, the power mode or the identity no longer pauses
  everything: only those values are left out, the activities are still
  followed. A 5xx of the activity list still pauses.
- The ack of a refused command no longer waits for the status publication nor
  for `/data`.
- A 401/403 of one command no longer stops the integration: a reading checks
  the key. A stop is tried once even while the key is held as refused, without
  making the wait longer, and even for an activity `/data` does not list.
- Readings after commands are grouped (one every 10 s at most), and one asked
  during a reading runs after it.
- A remote asleep costs one request per reading (the battery and the power
  mode are only asked once the activities answered).
- A refused HTTPS certificate is said in the status instead of "asleep".

[Unreleased]: https://github.com/LM1LC3N7/gladys-unfolded-circle/commits/main
