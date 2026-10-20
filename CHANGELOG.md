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

[Unreleased]: https://github.com/LM1LC3N7/gladys-unfolded-circle/commits/main
