// The pure decision layer for networks: given a validated request and the
// facts read through a port, work out what should happen. No IO here — that
// is what makes this file exhaustively testable with no network and no key.

import type { NetworksRequest } from "./requests.ts";

export type NetworksPlan = {
  readonly capability: "networks";
  readonly request: NetworksRequest;
};

export function planNetworks(request: NetworksRequest): NetworksPlan {
  return { capability: "networks", request };
}
