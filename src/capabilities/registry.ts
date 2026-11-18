// The capability list: one import and one entry each, both appended.
// Everything else about a capability lives in its own folder.
// `registry.test.ts` holds the invariants.

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
