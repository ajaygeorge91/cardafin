// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ajay George

// What the router knows about a capability.
//
// A capability declares its routes in its own folder and `registry.ts` lists
// it in one line, so adding one never means editing a shared table.
// `registry.test.ts` enforces the rule that makes that safe: a capability's
// paths all live under /<its own name>.

import type { Network } from "../core/network.ts";
import type { Clock } from "../ports/clock.ts";
import type { Logger } from "../ports/logger.ts";

/** Ports only — never an adapter, never `process.env`. */
export type CapabilityContext = {
  readonly network: Network;
  readonly log: Logger;
  readonly clock: Clock;
};

/** No `IncomingMessage`: auth, headers and body limits stay with the router. */
export type CapabilityInput = {
  /** Parsed JSON body; `{}` for a GET or an empty body. */
  readonly body: unknown;
  readonly query: URLSearchParams;
};

export type CapabilityResult = { readonly status: number; readonly body: unknown };

export type CapabilityRoute = {
  readonly method: "GET" | "POST";
  /** Under `/v1`, and must start with `/<capability name>`. */
  readonly path: string;
  readonly handler: (input: CapabilityInput) => Promise<CapabilityResult> | CapabilityResult;
};

export type CapabilityModule = {
  /** Must equal the folder name under `src/capabilities/`. */
  readonly name: string;
  readonly summary: string;
  readonly routes: (ctx: CapabilityContext) => readonly CapabilityRoute[];
};
