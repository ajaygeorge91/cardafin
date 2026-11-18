// The pure decision layer for sessions: given a validated request and the
// facts read through a port, work out what should happen. No IO here — that
// is what makes this file exhaustively testable with no network and no key.

import type { SessionsRequest } from "./requests.ts";

export type SessionsPlan = {
  readonly capability: "sessions";
  readonly request: SessionsRequest;
};

export function planSessions(request: SessionsRequest): SessionsPlan {
  return { capability: "sessions", request };
}
