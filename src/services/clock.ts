// The two clocks: the real one, and the one tests use. Anything that expires
// reads a Clock, so expiry is a number a test sets rather than a sleep.

import type { Clock } from "../ports/clock.ts";

export const systemClock: Clock = {
  now: () => Date.now(),
};

/** A clock that moves only when you move it. `advance` returns the new time. */
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
