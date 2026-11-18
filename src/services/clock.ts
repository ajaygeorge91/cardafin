// The two clocks: the real one, and the one tests use.
//
// Nothing outside this file calls `Date.now()` for anything that expires.
// A challenge, a session, a cached protocol-param set — all read a `Clock`,
// so "this nonce expired" is a test that sets a number rather than a test
// that sleeps. See src/ports/clock.ts.

import type { Clock } from "../ports/clock.ts";

export const systemClock: Clock = {
  now: () => Date.now(),
};

/**
 * A clock that only moves when you move it. `advance` returns the new time
 * so a test can read it back without a second call.
 */
export function fixedClock(start = 0): Clock & { advance(ms: number): number; set(ms: number): void } {
  let current = start;
  return {
    now: () => current,
    advance(ms: number) {
      current += ms;
      return current;
    },
    set(ms: number) {
      current = ms;
    },
  };
}
