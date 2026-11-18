// The nonce side of wallet login: issued, signed, then consumed exactly once.
//
// Two attacks this shape closes, and both need tests. Replay — the same
// signature presented twice. And cross-network replay, which CIP-8 warns
// about by name: signing against a testnet and presenting that on mainnet.
// The network is part of the challenge.

import type { Network } from "../core/network.ts";

/** What the signature is being asked for. Carried into the signed payload. */
export type ChallengePurpose = "login" | "link" | "proof-of-holding";

export const CHALLENGE_PURPOSES: readonly ChallengePurpose[] = [
  "login",
  "link",
  "proof-of-holding",
];

export type Challenge = {
  /** 32 random bytes, lowercase hex. The lookup key. */
  nonce: string;
  /** The origin this challenge is valid for, e.g. "cardafin.example.com". */
  domain: string;
  /** Closes the cross-network replay described above. */
  network: Network;
  purpose: ChallengePurpose;
  /** Epoch milliseconds, from a `Clock`. */
  issuedAt: number;
  expiresAt: number;
};

export interface ChallengeStore {
  /** Rejects a nonce that is already present rather than overwriting it. */
  issue(challenge: Challenge): Promise<void>;
  /**
   * Single use: returns the challenge and removes it in one step, so two
   * concurrent verifications of the same signature cannot both succeed.
   * Returns undefined for an unknown or already-consumed nonce. An expired
   * challenge is still returned — the verifier decides, so an expired nonce
   * and an unknown nonce can be reported as different errors.
   */
  consume(nonce: string): Promise<Challenge | undefined>;
  /** Drop everything expired at `now`. Returns how many were removed. */
  sweep(now: number): Promise<number>;
}
