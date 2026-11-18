// The pure decision layer for assets: given a validated request and the
// facts read through a port, work out what should happen. No IO here — that
// is what makes this file exhaustively testable with no network and no key.

import type { AssetsRequest } from "./requests.ts";

export type AssetsPlan = {
  readonly capability: "assets";
  readonly request: AssetsRequest;
};

export function planAssets(request: AssetsRequest): AssetsPlan {
  return { capability: "assets", request };
}
