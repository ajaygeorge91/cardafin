// The pure decision layer for identity: given a validated request and the
// facts read through a port, work out what should happen. No IO here — that
// is what makes this file exhaustively testable with no network and no key.

import type { IdentityRequest } from "./requests.ts";

export type IdentityPlan = {
  readonly capability: "identity";
  readonly request: IdentityRequest;
};

export function planIdentity(request: IdentityRequest): IdentityPlan {
  return { capability: "identity", request };
}
