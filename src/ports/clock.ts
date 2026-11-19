// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ajay George

// Time as a port, so anything that expires is tested by setting a number
// rather than by sleeping. See docs/ARCHITECTURE.md §4.

export interface Clock {
  /** Milliseconds since the Unix epoch. */
  now(): number;
}
