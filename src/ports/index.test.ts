// Ports are interfaces and type aliases: there is no runtime behaviour here
// to assert. What *can* go wrong is an interface that cannot actually be
// implemented, or a barrel that stops re-exporting something. So this file
// implements every port against core's real types — `npm run typecheck`
// checks the shapes, and the assertions below check the barrel and prove the
// implementations are callable.

import test from "node:test";
import assert from "node:assert/strict";

import type { Assets } from "../core/assets.ts";
import { LOVELACE } from "../core/assets.ts";
import type { ProtocolParams } from "../core/fees.ts";
import { CONWAY_DEFAULT_PARAMS } from "../core/fees.ts";
import type { NativeScript } from "../core/native-script.ts";
import type { Network } from "../core/network.ts";
import type { TxPlan } from "../core/plan.ts";
import type { Utxo } from "../core/types.ts";
import type {
  ChainReader,
  KeyPort,
  Logger,
  LogLevel,
  SignerRef,
  TxExecutor,
  TxReceipt,
  WalletInfo,
} from "./index.ts";

class StubChain implements ChainReader {
  readonly network: Network = "Preview";
  async getUtxos(address: string): Promise<Utxo[]> {
    return [{ txHash: "00".repeat(32), outputIndex: 0, address, assets: { [LOVELACE]: 1n } }];
  }
  async getBalance(_address: string): Promise<Assets> {
    return { [LOVELACE]: 1n };
  }
  async getCurrentSlot(): Promise<number> {
    return 7;
  }
  async getProtocolParams(): Promise<ProtocolParams> {
    return CONWAY_DEFAULT_PARAMS;
  }
  async awaitTx(_txHash: string, _timeoutMs?: number): Promise<boolean> {
    return true;
  }
}

class StubKeys implements KeyPort {
  generateMnemonic(): string {
    return "word ".repeat(23).concat("last");
  }
  validateMnemonic(_m: string): boolean {
    return true;
  }
  async deriveWallet(
    _mnemonic: string,
    accountIndex: number,
    network: Network,
  ): Promise<WalletInfo> {
    return { address: "addr_test1stub", paymentKeyHash: "ab".repeat(28), accountIndex, network };
  }
  nativeScriptPolicyId(_script: NativeScript): string {
    return "cd".repeat(28);
  }
}

class StubExecutor implements TxExecutor {
  readonly route: "l1" = "l1";
  async execute(_plan: TxPlan, _signer: SignerRef): Promise<TxReceipt> {
    return { txHash: "ef".repeat(32), fee: 170_000n, route: "l1" };
  }
}

test("every port is implementable with core's own types", async () => {
  const chain: ChainReader = new StubChain();
  assert.equal(chain.network, "Preview");
  assert.equal((await chain.getUtxos("addr_test1x"))[0]?.outputIndex, 0);
  assert.equal(await chain.getCurrentSlot(), 7);
  assert.equal((await chain.getProtocolParams()).minFeeB, 155_381);
  assert.equal(await chain.awaitTx("ab"), true);

  const keys: KeyPort = new StubKeys();
  assert.equal(keys.generateMnemonic().split(" ").length, 24);
  assert.equal((await keys.deriveWallet("m", 3, "Preprod")).accountIndex, 3);
  assert.equal(keys.nativeScriptPolicyId({ type: "before", slot: 1 }).length, 56);

  const executor: TxExecutor = new StubExecutor();
  assert.equal(executor.route, "l1");
  const plan: TxPlan = {
    kind: "send-ada",
    network: "Preview",
    route: "l1",
    from: "addr_test1from",
    outputs: [],
  };
  const receipt = await executor.execute(plan, { mnemonic: "m", accountIndex: 0 });
  assert.equal(receipt.fee, 170_000n);
});

test("Logger has exactly the four level methods", () => {
  const seen: Array<{ level: LogLevel; msg: string }> = [];
  const log: Logger = {
    debug: (msg) => seen.push({ level: "debug", msg }),
    info: (msg) => seen.push({ level: "info", msg }),
    warn: (msg) => seen.push({ level: "warn", msg }),
    error: (msg) => seen.push({ level: "error", msg }),
  };
  log.debug("d");
  log.info("i", { a: 1 });
  log.warn("w");
  log.error("e", { nested: { b: 2 } });
  assert.deepEqual(
    seen.map((s) => s.level),
    ["debug", "info", "warn", "error"],
  );
});
