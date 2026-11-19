# Changelog

Notable changes to cardafin. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [semantic versioning](https://semver.org/) once there is a
release. There is no release yet — `main` is the only thing to track.

## Unreleased

### Added

- Port contracts for the five planned modules — `identity`, `challenges`,
  `clock`, `accounts`, `policies`, `oauth`, `sessions`, `provider` — recorded
  in `src/ports/frozen.json` so a contract change shows up as a manifest diff.
- Capability convention: one module per folder, registered in one line in
  `src/capabilities/registry.ts`, with tests enforcing that every folder is
  registered, that paths stay under their own module's name, and that no
  module imports another.
- Published specification vectors in `src/fixtures/` — BLAKE2b at 512, 224 and
  160 bits (512 is RFC 7693's reference value) and all eight CIP-14 asset
  fingerprints.
- `npm run console` — the whole service over the in-memory adapters with no
  `node_modules`, no network and no key, plus a browser page.
- `npm run console:probe` — the same checks printed as text, for use without a
  browser; non-zero exit if a route answers unexpectedly.
- `web/login.mjs` — the CIP-30 browser half of wallet login, including the
  wrong-network guard.
- CI: an `offline` job that installs nothing and asserts `node_modules` is
  absent before running the suite, the probe and the port-contract check.
- `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue and pull
  request templates.

### Changed

- **Licence: MIT → Apache License 2.0**, for the patent grant in §3. Commits up
  to `9583f21` remain available under MIT to anyone who already had a copy.
- Every source file now carries a two-line SPDX header, enforced by
  `src/core/license.test.ts`.
- `web/**/*.test.mjs` runs under `npm test`; the glob previously covered only
  `src`, so the browser tests had never run.
- The five module folders hold a brief and a route declaration. Routes answer
  `501 NOT_IMPLEMENTED` with a pointer to their README until implemented.

### Fixed

- `scripts/freeze-ports.mjs` stripped block comments after filtering blank
  lines, so reflowing a doc comment changed a port's fingerprint. Comments are
  now genuinely free, with a test.

## v1 — 2026-11-08

The wallet manager, in the step order of `docs/ARCHITECTURE.md` §8: pure core,
ports, in-memory adapters, the Lucid/Blockfrost adapter, config, a CLI, and a
`node:http` surface. Wallet create and restore, address derivation, balances
and UTxOs, sending ADA, native-token policies, minting and token transfers.
Untagged; `e642284` is the last commit of this phase.
