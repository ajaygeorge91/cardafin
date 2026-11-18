// The capability list. This is the one file five parallel branches share,
// and it is append-only by construction: a capability is two lines — an
// import and a list entry — both added at the end of their block.
//
// Nothing else about a capability appears here. Its services, its ports, its
// route paths and its fixtures all live in its own folder, so "add a
// capability" never means "edit a table someone else is also editing".
//
// `registry.test.ts` holds the invariants that make that safe:
//   * every folder under src/capabilities/ is registered, and every
//     registered name is a folder — a capability cannot be silently dark;
//   * every route path starts with `/<its own capability name>`, so two
//     capabilities cannot collide on a path;
//   * no capability shadows a v1 route that already exists.
//
// See docs/ARCHITECTURE.md §1.

import type { CapabilityModule } from "./types.ts";

import { accountsCapability } from "./accounts/capability.ts";
import { assetsCapability } from "./assets/capability.ts";
import { identityCapability } from "./identity/capability.ts";
import { networksCapability } from "./networks/capability.ts";
import { sessionsCapability } from "./sessions/capability.ts";

export const CAPABILITIES: readonly CapabilityModule[] = [
  accountsCapability,
  assetsCapability,
  identityCapability,
  networksCapability,
  sessionsCapability,
];
