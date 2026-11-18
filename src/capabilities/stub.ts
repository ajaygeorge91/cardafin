// `notBuilt` — the honest 501.
//
// Every capability declares its real route surface from day one and answers
// 501 NOT_IMPLEMENTED on the parts that are not written yet, with a pointer
// to the README that says how to finish them. Two reasons:
//
//   * the console and `npm run console -- --probe` show the whole intended
//     surface and exactly which endpoints are still dark, so "done" is a
//     thing you can look at rather than a thing you assert;
//   * a route that 404s reads as a typo. A route that 501s with its own
//     README path reads as work.
//
// When a capability is finished it has no `notBuilt` left and the import
// goes with it. See docs/ARCHITECTURE.md §1.

import { CardafinError } from "../core/errors.ts";

export function notBuilt(capability: string, what: string): never {
  throw new CardafinError("NOT_IMPLEMENTED", `${capability}: ${what} is not built yet`, {
    readme: `src/capabilities/${capability}/README.md`,
    doneWhen: `node --test --experimental-strip-types 'src/capabilities/${capability}/*.test.ts'`,
  });
}
