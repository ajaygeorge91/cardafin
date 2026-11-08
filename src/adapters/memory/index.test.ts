import test from "node:test";
import assert from "node:assert/strict";

import * as memory from "./index.ts";

test("the memory barrel re-exports every adapter", () => {
  for (const name of [
    "MemoryKeys",
    "MemoryLedger",
    "HydraExecutor",
    "policyIdOf",
    "paymentKeyHashOf",
    "nativeScriptToJson",
    "FAKE_WORDLIST",
    "MNEMONIC_WORDS",
    "HYDRA_NOT_IMPLEMENTED_MESSAGE",
  ]) {
    assert.ok(Object.hasOwn(memory, name), `adapters/memory/index.ts does not export ${name}`);
  }
});
