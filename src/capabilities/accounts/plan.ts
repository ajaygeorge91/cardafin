// The pure decision layer for accounts: given a validated request and the
// facts read through a port, work out what should happen. No IO here — that
// is what makes this file exhaustively testable with no network and no key.

import type { AccountsRequest } from "./requests.ts";

export type AccountsPlan = {
  readonly capability: "accounts";
  readonly request: AccountsRequest;
};

export function planAccounts(request: AccountsRequest): AccountsPlan {
  return { capability: "accounts", request };
}
