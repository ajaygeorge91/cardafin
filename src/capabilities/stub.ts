// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ajay George

// The 501 a declared-but-unwritten route answers. A finished capability has
// no `notBuilt` left in it.

import { CardafinError } from "../core/errors.ts";

export function notBuilt(capability: string, what: string): never {
  throw new CardafinError("NOT_IMPLEMENTED", `${capability}: ${what} is not built yet`, {
    readme: `src/capabilities/${capability}/README.md`,
  });
}
