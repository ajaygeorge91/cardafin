// Verifying a CIP-30 wallet signature.
//
// `sessions` depends on this and on nothing else from `identity`, so the two
// can be built in either order: sessions tests against a fake verifier,
// identity ships the real one.

import type { Network } from "../core/network.ts";
import type { Result } from "../core/result.ts";
import type { ChallengePurpose } from "./challenges.ts";

/** What CIP-30 `signData` hands back, verbatim — nothing is decoded in the
 *  browser. */
export type DataSignature = {
  /** COSE_Sign1, hex CBOR. Carries the payload attached (CIP-30 does not hash it). */
  signature: string;
  /** COSE_Key holding the Ed25519 public key, hex CBOR. */
  key: string;
};

export type VerifyRequest = {
  signature: DataSignature;
  /** The origin the challenge was issued for; another domain must not pass. */
  expectedDomain: string;
  network: Network;
  /** Epoch milliseconds, from a `Clock`. Expiry is judged against this. */
  now: number;
};

export type VerifiedIdentity = {
  /**
   * The bech32 reward (stake) address the wallet bound into the COSE
   * protected header. Wallets sign with the stake credential; an "address"
   * header in any other format is a verification failure, not a fallback.
   */
  rewardAddress: string;
  /** The Ed25519 public key from the COSE_Key, 32 bytes as lowercase hex. */
  publicKeyHex: string;
  network: Network;
  /** The nonce consumed to produce this identity. */
  nonce: string;
  purpose: ChallengePurpose;
  verifiedAt: number;
};

export interface IdentityVerifier {
  /**
   * Decode, verify, consume. Every failure mode — tampered payload, wrong
   * address, unknown or reused nonce, expired challenge, wrong network or
   * domain — comes back as `Err`; untrusted input never throws.
   */
  verify(req: VerifyRequest): Promise<Result<VerifiedIdentity>>;
}
