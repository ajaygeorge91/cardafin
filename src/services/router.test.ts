import test from "node:test";
import assert from "node:assert/strict";

import { isCardafinError } from "../core/errors.ts";
import type { TxPlan } from "../core/plan.ts";
import type { SignerRef, TxExecutor, TxReceipt, TxRoute } from "../ports/executor.ts";
import { TxRouter } from "./router.ts";

function stub(route: TxRoute, txHash: string): TxExecutor {
  return {
    route,
    async execute(_plan: TxPlan, _signer: SignerRef): Promise<TxReceipt> {
      return { txHash, fee: 0n, route };
    },
  };
}

test("for('l1') returns the l1 executor", () => {
  const l1 = stub("l1", "aa");
  const router = new TxRouter({ l1 });
  assert.equal(router.for("l1"), l1);
  assert.equal(router.hasHydra, false);
});

test("for('hydra') throws NOT_IMPLEMENTED when no hydra executor is wired", () => {
  const router = new TxRouter({ l1: stub("l1", "aa") });
  assert.throws(
    () => router.for("hydra"),
    (e: unknown) => {
      assert.ok(isCardafinError(e));
      assert.equal(e.code, "NOT_IMPLEMENTED");
      assert.match(e.message, /no hydra executor is configured/);
      return true;
    },
  );
});

test("for('hydra') returns the hydra executor when one is wired", () => {
  const l1 = stub("l1", "aa");
  const hydra = stub("hydra", "bb");
  const router = new TxRouter({ l1, hydra });
  assert.equal(router.hasHydra, true);
  assert.equal(router.for("hydra"), hydra);
  assert.equal(router.for("l1"), l1);
});

test("an explicitly undefined hydra is the same as none", () => {
  const router = new TxRouter({ l1: stub("l1", "aa"), hydra: undefined });
  assert.equal(router.hasHydra, false);
  assert.throws(() => router.for("hydra"));
});
