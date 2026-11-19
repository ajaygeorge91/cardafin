// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ajay George

// Sessions, and the account they belong to: one account, two kinds of
// credential, either able to log in.
//
// The rules that make that safe are the work, not the storage:
//   * linking a credential that already belongs to another account is refused;
//   * unlinking the last credential is refused — it orphans the account;
//   * linking needs a fresh "link"-purpose proof from the credential being
//     added, not just a session from the one already there.

import type { Result } from "../core/result.ts";
import type { OAuthProviderId } from "./oauth.ts";

/** One way of proving you are the account holder. */
export type CredentialRef =
  | { kind: "wallet"; rewardAddress: string }
  | { kind: "oauth"; providerId: OAuthProviderId; subject: string };

export type LinkedAccount = {
  /** Opaque, stable, never derived from a credential — credentials can be unlinked. */
  accountId: string;
  credentials: readonly CredentialRef[];
  createdAt: number;
};

export type Session = {
  id: string;
  accountId: string;
  /** Which credential was actually used for this login. */
  credential: CredentialRef;
  issuedAt: number;
  expiresAt: number;
};

export interface SessionStore {
  create(session: Session): Promise<void>;
  get(id: string): Promise<Session | undefined>;
  /** True if a live session was revoked, false if it was unknown or already gone. */
  revoke(id: string): Promise<boolean>;
  /** Every session for an account — the "sign out everywhere" primitive. Returns the count. */
  revokeAllForAccount(accountId: string): Promise<number>;
  sweep(now: number): Promise<number>;
}

export interface AccountLinkStore {
  findByCredential(ref: CredentialRef): Promise<LinkedAccount | undefined>;
  get(accountId: string): Promise<LinkedAccount | undefined>;
  /** Creates an account holding exactly one credential. */
  create(accountId: string, first: CredentialRef, now: number): Promise<Result<LinkedAccount>>;
  /** Refuses a credential already attached to another account. */
  link(accountId: string, ref: CredentialRef): Promise<Result<LinkedAccount>>;
  /** Refuses removing the last credential on the account. */
  unlink(accountId: string, ref: CredentialRef): Promise<Result<LinkedAccount>>;
}
