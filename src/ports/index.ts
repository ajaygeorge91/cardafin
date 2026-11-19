// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ajay George

// The port surface. Adapters implement these; services and capabilities
// consume them. Nothing here imports anything but `../core` and other ports.
//
// `frozen.test.ts` guards them: changing a contract means running
// `npm run freeze` and committing a one-line manifest diff.

export * from "./chain.ts";
export * from "./keys.ts";
export * from "./executor.ts";
export * from "./logger.ts";
export * from "./clock.ts";
export * from "./challenges.ts";
export * from "./identity.ts";
export * from "./accounts.ts";
export * from "./policies.ts";
export * from "./oauth.ts";
export * from "./sessions.ts";
export * from "./provider.ts";
