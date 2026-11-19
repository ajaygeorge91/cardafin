# Security

## Reporting a vulnerability

Use GitHub's private vulnerability reporting: go to the
[Security tab](https://github.com/ajaygeorge91/cardafin/security/advisories/new)
and open a draft advisory. That keeps the report private until there is a fix.

Please do not open a public issue for anything that could be used against a
deployment holding funds.

There is no bug bounty. I will acknowledge a report, say whether I think it is
in scope, and credit you in the advisory unless you would rather not be.

## What I am most interested in

- **The signature path.** Anything that makes `IdentityVerifier` accept a
  signature it should reject: a replayed nonce, a signature produced for
  another domain or another network, a public key that does not hash to the
  address in the protected header, a CBOR input that is decoded two different
  ways.
- **Key handling.** Any way a mnemonic, a derived key or a transaction witness
  reaches a log, an error message or an HTTP response. `src/adapters/lucid/keys.ts`
  is the only file that touches signing material, and the logger's redaction
  rules are in `src/services/logger.ts`.
- **The auth gate.** Anything that serves a protected route without a valid
  bearer token, or that makes the `503` fail-closed behaviour fail open.
- **The mainnet gate.** Any path that submits against Mainnet without
  `CARDAFIN_MAINNET_CONFIRM=I_UNDERSTAND_REAL_FUNDS`.

## What is already known, and not a vulnerability

These are documented limits of the current version rather than bugs. Reports
about them are welcome as issues, not advisories:

- **Key custody is a single master mnemonic in an environment variable**
  (`CARDAFIN_MNEMONIC`). Anything that can read the process environment can
  move every account's funds. This is adequate for a single-operator testnet
  service and is explicitly not adequate for meaningful mainnet funds; the
  upgrade path is a KMS- or HSM-backed implementation behind `KeyPort`. See
  `docs/ARCHITECTURE.md` §6.
- **Policies are held in memory for the life of the process.** Lose the
  `PolicyInfo` and the policy can never mint or burn again.
- **The five modules under `src/capabilities/` are unimplemented** and answer
  `501`. There is nothing there to attack yet.
- **The dev console** (`npm run console`) has a hardcoded, obviously-fake API
  key and runs against a fake ledger. It has no executor behind it and cannot
  reach a chain.

## Supported versions

Pre-1.0 and unreleased: fixes land on `main`, and there are no backports.
