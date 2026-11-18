// The contract every capability module implements, and the only thing the
// router knows about a capability.
//
// Why this exists: five sessions build five capabilities in parallel, and
// the router's route table is the one file all five would otherwise edit.
// A capability instead *declares* its routes in its own folder, and
// `registry.ts` names it in one line. Two branches that each append a line
// merge; two branches that each edit the same table do not.
//
// `registry.test.ts` enforces the part that makes the one-line registration
// safe: a capability's paths all live under `/<its own name>`, so two
// capabilities cannot collide on a path even by accident.
// See docs/ARCHITECTURE.md §1.

import type { Network } from "../core/network.ts";
import type { Clock } from "../ports/clock.ts";
import type { Logger } from "../ports/logger.ts";

/**
 * What a capability is handed at wiring time. Ports only — never an adapter,
 * never `process.env`, never a concrete service from another capability.
 * A capability that needs more than this (a `ChallengeStore`, an
 * `AccountReader`) constructs its own memory adapter here and takes the real
 * one through its service's deps, the same way `src/app.ts` does.
 */
export type CapabilityContext = {
  readonly network: Network;
  readonly log: Logger;
  readonly clock: Clock;
};

/** Everything a route handler gets. No `IncomingMessage`: a capability must
 *  stay testable without an HTTP server, and headers are the router's job. */
export type CapabilityInput = {
  /** Parsed JSON body; `{}` for a GET or an empty body. */
  readonly body: unknown;
  readonly query: URLSearchParams;
};

export type CapabilityResult = {
  readonly status: number;
  readonly body: unknown;
};

export type CapabilityRoute = {
  readonly method: "GET" | "POST";
  /**
   * Path under `/v1`, and it must start with `/<capability name>` — that is
   * what makes one-line registration collision-proof. So `identity`
   * contributes `/identity/verify`, never `/auth/verify`.
   */
  readonly path: string;
  readonly handler: (input: CapabilityInput) => Promise<CapabilityResult> | CapabilityResult;
};

export type CapabilityModule = {
  /** Must equal the folder name under `src/capabilities/`. */
  readonly name: string;
  /** One-line summary; the console shows it. */
  readonly summary: string;
  readonly routes: (ctx: CapabilityContext) => readonly CapabilityRoute[];
};
