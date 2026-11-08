import test from "node:test";
import assert from "node:assert/strict";

import { isCardafinError } from "../../core/errors.ts";
import type { TxPlan } from "../../core/plan.ts";
import { HYDRA_NOT_IMPLEMENTED_MESSAGE, HydraExecutor } from "./hydra.ts";

const PLAN: TxPlan = {
  kind: "send-ada",
  network: "Preview",
  route: "hydra",
  from: "addr_test1from",
  outputs: [],
};

test("HydraExecutor claims the hydra route", () => {
  assert.equal(new HydraExecutor().route, "hydra");
});

test("HydraExecutor.execute rejects with NOT_IMPLEMENTED", async () => {
  await assert.rejects(
    () => new HydraExecutor().execute(PLAN, { mnemonic: "x", accountIndex: 0 }),
    (e: unknown) => {
      assert.ok(isCardafinError(e));
      assert.equal(e.code, "NOT_IMPLEMENTED");
      assert.equal(e.message, HYDRA_NOT_IMPLEMENTED_MESSAGE);
      assert.match(e.message, /designed but not built/);
      assert.match(e.message, /docs\/ARCHITECTURE\.md/);
      return true;
    },
  );
});
