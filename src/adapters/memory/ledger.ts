// MemoryLedger: an in-memory Cardano ledger that implements both the read
// port (`ChainReader`) and the "l1" write port (`TxExecutor`). Deterministic,
// dependency-free and the thing every service test runs against.
//
// It is a *model* of the ledger rules cardafin cares about — min-ADA per
// output, address network, native-script time locks, policy id ↔ script
// agreement, required signers, fee deduction, change — not a chain. It has no
// mempool, no blocks, no rollbacks, no Plutus and no real cryptography. Money
// in here is imaginary.
//
// See docs/ARCHITECTURE.md §4.

import { CardafinError } from "../../core/errors.ts";
import { validateAddress } from "../../core/address.ts";
import type { Assets } from "../../core/assets.ts";
import {
  LOVELACE,
  addAssets,
  lovelaceOf,
  nativeAssetsOf,
  subtractAssets,
  sumUtxoAssets,
} from "../../core/assets.ts";
import { formatAda } from "../../core/ada.ts";
import type { ProtocolParams } from "../../core/fees.ts";
import {
  CONWAY_DEFAULT_PARAMS,
  estimateFee,
  estimateMinAda,
  estimateSimpleTxBytes,
} from "../../core/fees.ts";
import type { Json } from "../../core/metadata.ts";
import { canonicalJson, sha256Hex } from "../../core/metadata.ts";
import { keyHashesOf, policyIsOpenAt } from "../../core/native-script.ts";
import type { Network } from "../../core/network.ts";
import { explorerTxUrl } from "../../core/network.ts";
import type { TxOutput, TxPlan } from "../../core/plan.ts";
import { estimatePlanMetadataBytes } from "../../core/plan.ts";
import { unwrap } from "../../core/result.ts";
import type { Utxo } from "../../core/types.ts";
import { utxoRef } from "../../core/types.ts";
import type { ChainReader } from "../../ports/chain.ts";
import type { SignerRef, TxExecutor, TxReceipt } from "../../ports/executor.ts";
import type { KeyPort } from "../../ports/keys.ts";
import { MemoryKeys, nativeScriptToJson } from "./keys.ts";

export type MemoryLedgerOptions = {
  slot?: number;
  params?: ProtocolParams;
  /**
   * Used to re-derive the signer's key hash when checking a mint's required
   * signatures, and to recompute a policy id from its script. Defaults to a
   * fresh `MemoryKeys`, which is what every test wants.
   */
  keys?: KeyPort;
};

/** Assets as a JSON-safe map, for the deterministic tx hash. */
function assetsToJson(assets: Assets): Record<string, string> {
  const out: Record<string, string> = {};
  for (const unit of Object.keys(assets).sort()) {
    out[unit] = (assets[unit] ?? 0n).toString();
  }
  return out;
}

function outputToJson(output: TxOutput): Json {
  return { address: output.address, assets: assetsToJson(output.assets) };
}

export class MemoryLedger implements ChainReader, TxExecutor {
  readonly network: Network;
  readonly route: "l1" = "l1";

  /** Every receipt this ledger has produced, oldest first. */
  readonly history: TxReceipt[] = [];

  /** The plan behind `history.at(-1)`. Test affordance; never read by code. */
  lastPlan?: TxPlan;

  #utxos = new Map<string, Utxo>();
  #slot: number;
  #params: ProtocolParams;
  #keys: KeyPort;
  /**
   * One monotonic counter behind both `fund` and `execute`, so that two
   * ledgers driven through the same sequence of calls produce the same
   * hashes. It is what makes this adapter reproducible.
   */
  #nonce = 0;
  #minted: Assets = {};
  #produced = new Set<string>();

  constructor(network: Network, opts: MemoryLedgerOptions = {}) {
    this.network = network;
    this.#slot = opts.slot ?? 0;
    this.#params = opts.params ?? CONWAY_DEFAULT_PARAMS;
    this.#keys = opts.keys ?? new MemoryKeys();
  }

  // --- test seams -------------------------------------------------------

  /**
   * Create a UTxO out of nothing at `address`. The tx hash is
   * sha256(counter + address), so funding is deterministic per ledger.
   */
  fund(address: string, assets: Assets): Utxo {
    const txHash = sha256Hex(`cardafin:memory-ledger:fund:${this.#nonce++}:${address}`);
    const utxo: Utxo = { txHash, outputIndex: 0, address, assets: { ...assets } };
    this.#utxos.set(utxoRef(utxo), utxo);
    this.#produced.add(txHash);
    return utxo;
  }

  setSlot(n: number): void {
    if (!Number.isSafeInteger(n) || n < 0) {
      throw new CardafinError("INVALID_REQUEST", "slot must be a non-negative whole number");
    }
    this.#slot = n;
  }

  advanceSlots(n: number): void {
    this.setSlot(this.#slot + n);
  }

  /** Net quantity of `unit` this ledger has minted (burns subtract). */
  mintedSupply(unit: string): bigint {
    return this.#minted[unit] ?? 0n;
  }

  /** Every UTxO in the ledger, in insertion order. */
  allUtxos(): Utxo[] {
    return [...this.#utxos.values()];
  }

  // --- ChainReader ------------------------------------------------------

  async getUtxos(address: string): Promise<Utxo[]> {
    return [...this.#utxos.values()]
      .filter((u) => u.address === address)
      .map((u) => ({ ...u, assets: { ...u.assets } }));
  }

  async getBalance(address: string): Promise<Assets> {
    return sumUtxoAssets(await this.getUtxos(address));
  }

  async getCurrentSlot(): Promise<number> {
    return this.#slot;
  }

  async getProtocolParams(): Promise<ProtocolParams> {
    return { ...this.#params };
  }

  /** True iff this ledger produced `txHash`. No waiting: there is no mempool. */
  async awaitTx(txHash: string, _timeoutMs?: number): Promise<boolean> {
    return this.#produced.has(txHash);
  }

  // --- TxExecutor -------------------------------------------------------

  async execute(plan: TxPlan, signer: SignerRef): Promise<TxReceipt> {
    if (plan.network !== this.network) {
      throw new CardafinError(
        "PROVIDER_ERROR",
        `plan is for ${plan.network} but this ledger is on ${this.network}`,
        { planNetwork: plan.network, ledgerNetwork: this.network },
      );
    }
    if (plan.route !== "l1") {
      throw new CardafinError(
        "PROVIDER_ERROR",
        `MemoryLedger executes route "l1", not "${plan.route}"`,
        { route: plan.route },
      );
    }

    // The planner already checked these; an executor that trusts its input is
    // an executor that submits a bad transaction. Re-check everything.
    const from = validateAddress(plan.from, this.network);
    if (!from.ok) {
      throw from.error;
    }
    for (const output of plan.outputs) {
      const address = validateAddress(output.address, this.network);
      if (!address.ok) {
        throw address.error;
      }
      const minimum = estimateMinAda(output.assets, this.#params);
      const have = lovelaceOf(output.assets);
      if (have < minimum) {
        throw new CardafinError(
          "BELOW_MIN_ADA",
          `output of ${formatAda(have)} is below the minimum of ${formatAda(minimum)}`,
          { minimum, provided: have },
        );
      }
    }

    if (plan.mint) {
      const expected = this.#keys.nativeScriptPolicyId(plan.mint.script);
      if (expected !== plan.mint.policyId) {
        throw new CardafinError(
          "PROVIDER_ERROR",
          `policy id does not match the attached script: plan says ${plan.mint.policyId}, the script hashes to ${expected}`,
          { planPolicyId: plan.mint.policyId, scriptPolicyId: expected },
        );
      }
      if (!policyIsOpenAt(plan.mint.script, this.#slot)) {
        throw new CardafinError(
          "PROVIDER_ERROR",
          `policy locked: it cannot mint at slot ${this.#slot}`,
          { currentSlot: this.#slot },
        );
      }
      if (plan.validToSlot !== undefined && this.#slot > plan.validToSlot) {
        throw new CardafinError(
          "PROVIDER_ERROR",
          `validity window passed: the plan is valid to slot ${plan.validToSlot}, the chain is at ${this.#slot}`,
          { validToSlot: plan.validToSlot, currentSlot: this.#slot },
        );
      }
      const wallet = await this.#keys.deriveWallet(
        signer.mnemonic,
        signer.accountIndex,
        this.network,
      );
      if (!keyHashesOf(plan.mint.script).includes(wallet.paymentKeyHash)) {
        throw new CardafinError(
          "PROVIDER_ERROR",
          "missing signer: the policy requires a key hash the signer does not hold",
          { required: keyHashesOf(plan.mint.script), signer: wallet.paymentKeyHash },
        );
      }
    }

    // No coin selection: a fake ledger spends the whole wallet and returns
    // change, which keeps the UTxO set small and the hashes stable.
    const inputs = [...this.#utxos.values()].filter((u) => u.address === plan.from);

    let fee = estimateFee(
      estimateSimpleTxBytes(
        plan.outputs.length + 1,
        inputs.length,
        plan.mint !== undefined,
        estimatePlanMetadataBytes(plan),
      ),
      this.#params,
    );

    // required = Σ outputs + fee, and a mint is extra value entering the
    // transaction (a burn — a negative quantity — is value leaving it), so
    // folding `plan.mint.assets` into what is available is the same sum as
    // subtracting minted positives from `required`.
    const available = addAssets(sumUtxoAssets(inputs), plan.mint?.assets ?? {});
    let required: Assets = { [LOVELACE]: fee };
    for (const output of plan.outputs) {
      required = addAssets(required, output.assets);
    }
    const change = subtractAssets(available, required);
    if (!change.ok) {
      throw new CardafinError(
        "INSUFFICIENT_FUNDS",
        `${plan.from.slice(0, 12)}… cannot cover this transaction: needs ${formatAda(lovelaceOf(required))} plus tokens, has ${formatAda(lovelaceOf(available))}`,
        { required, available, fee, inputs: inputs.length },
      );
    }

    const outputs: TxOutput[] = plan.outputs.map((o) => ({
      address: o.address,
      assets: { ...o.assets },
    }));
    const changeLovelace = lovelaceOf(change.value);
    const changeTokens = nativeAssetsOf(change.value);
    if (Object.keys(changeTokens).length > 0) {
      // Tokens cannot be abandoned into the fee, so a token-bearing change
      // output must stand on its own min-ADA. If it cannot, the transaction
      // is simply not constructible.
      const minimum = estimateMinAda(change.value, this.#params);
      if (changeLovelace < minimum) {
        throw new CardafinError(
          "BELOW_MIN_ADA",
          `change output carries tokens but only ${formatAda(changeLovelace)}, below the minimum of ${formatAda(minimum)}`,
          { minimum, provided: changeLovelace },
        );
      }
      outputs.push({ address: plan.from, assets: change.value });
    } else if (changeLovelace > 0n) {
      const minimum = estimateMinAda(change.value, this.#params);
      if (changeLovelace < minimum) {
        // Dust change: ADA-only and too small to be its own UTxO. A real
        // ledger has the same problem and the same answer — the leftover is
        // added to the fee rather than creating an unspendable output. The
        // receipt's `fee` therefore reports the total, not the estimate.
        fee += changeLovelace;
      } else {
        outputs.push({ address: plan.from, assets: change.value });
      }
    }

    const nonce = this.#nonce++;
    const txHash = sha256Hex(
      unwrap(
        canonicalJson({
          inputs: inputs.map(utxoRef),
          outputs: outputs.map(outputToJson),
          mint: plan.mint
            ? {
                policyId: plan.mint.policyId,
                script: nativeScriptToJson(plan.mint.script),
                assets: assetsToJson(plan.mint.assets),
              }
            : null,
          slot: this.#slot,
          nonce,
        }),
      ),
    );

    for (const input of inputs) {
      this.#utxos.delete(utxoRef(input));
    }
    for (let i = 0; i < outputs.length; i++) {
      const output = outputs[i];
      if (!output) {
        continue;
      }
      const utxo: Utxo = {
        txHash,
        outputIndex: i,
        address: output.address,
        assets: output.assets,
      };
      this.#utxos.set(utxoRef(utxo), utxo);
    }
    if (plan.mint) {
      this.#minted = addAssets(this.#minted, nativeAssetsOf(plan.mint.assets));
    }

    const receipt: TxReceipt = {
      txHash,
      fee,
      route: "l1",
      explorerUrl: explorerTxUrl(this.network, txHash),
    };
    this.#produced.add(txHash);
    this.history.push(receipt);
    this.lastPlan = plan;
    return receipt;
  }
}
