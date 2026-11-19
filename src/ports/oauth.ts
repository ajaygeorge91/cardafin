// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ajay George

// The OAuth half of login. One adapter per provider; the real ones never run
// in a test, so this stays small enough to fake.

import type { Result } from "../core/result.ts";

export type OAuthProviderId = string;

export type AuthorizeRequest = {
  /** CSRF token, echoed back on the callback. The caller stores and checks it. */
  state: string;
  redirectUri: string;
  scopes?: readonly string[];
};

export type OAuthSubject = {
  providerId: OAuthProviderId;
  /** The provider's stable user id. Never an email — emails change hands. */
  subject: string;
  email?: string;
  /**
   * False unless the provider positively asserts verification. An
   * unverified email must never be enough to link to an existing account —
   * that is account takeover with extra steps.
   */
  emailVerified: boolean;
};

export interface OAuthProvider {
  readonly id: OAuthProviderId;
  authorizeUrl(req: AuthorizeRequest): string;
  exchangeCode(code: string, redirectUri: string): Promise<Result<OAuthSubject>>;
}
