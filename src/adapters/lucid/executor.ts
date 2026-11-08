// LucidExecutor: the "l1" `TxExecutor`. The only place in cardafin that
// builds, signs and submits a real Cardano transaction.
//
// Everything interesting about *what* a transaction contains happened
// already: core produced the `TxPlan`, `translate.ts` turns it into builder
// calls and is tested offline. What is left here is the part that genuinely
// needs a network — provider setup, coin selection and fees via
// `.complete()`, signing, submission — plus three guards:
//
//   * the plan's route and network must match this executor's,
//   * the wallet the plan was built *for* must be the wallet lucid selected
//     (otherwise coin selection would spend a different account's UTxOs),
//   * Mainnet needs an explicit confirmation, re-checked here even though
//     `loadConfig` and `TxService` both already did it.
//
// Logging: one line before submit, carrying `describePlan(plan)` and the tx
// hash. Never the mnemonic, never the CBOR. Lucid's own error messages can
// contain a whole serialised transaction, so `sanitiseProviderMessage`
// strips long hex runs and truncates before any message is re-thrown.
//
// See docs/ARCHITECTURE.md §4.

import { Blockfrost, Lucid, scriptFromNative } from "@lucid-evolution/lucid";

import type { Lovelace } from "../../core/ada.ts";
import { CardafinError, isCardafinError } from "../../core/errors.ts";
import type { TxPlan } from "../../core/plan.ts";
import { describePlan, estimatePlanMetadataBytes } from "../../core/plan.ts";
import { estimateFee, estimateSimpleTxBytes } from "../../core/fees.ts";
import type { Network } from "../../core/network.ts";
import { explorerTxUrl, isMainnet } from "../../core/network.ts";
import type { SignerRef, TxExecutor, TxReceipt } from "../../ports/executor.ts";
import type { Logger } from "../../ports/logger.ts";
import { applyPlan } from "./translate.ts";

export type LucidExecutorConfig = {
  network: Network;
  projectId: string;
  blockfrostUrl: string;
  /**
   * Must be `true` to submit on Mainnet. The third of three checks (the
   * others are `loadConfig` and `TxService`), on the principle that the last
   * gate before real money should not be in a different file from the submit.
   */
  mainnetConfirmed?: boolean;
};

/** Longest provider message re-thrown verbatim. Beyond this it is truncated. */
export const MAX_PROVIDER_MESSAGE_CHARS = 500;

/** A hex run this long in an error is a serialised transaction, not an id. */
export const PROVIDER_MESSAGE_HEX_RUN = 400;

const HEX_RUN_RE = new RegExp(`[0-9a-fA-F]{${PROVIDER_MESSAGE_HEX_RUN},}`, "g");

/**
 * Make a third-party error message safe to re-throw. Lucid and the node both
 * like to quote the offending transaction, which means a signed body — and a
 * signed body in a log line is a witness set in a log line.
 */
export function sanitiseProviderMessage(message: string): string {
  const stripped = message.replace(
    HEX_RUN_RE,
    (match) => `[omitted:hex len ${match.length}]`,
  );
  return stripped.length > MAX_PROVIDER_MESSAGE_CHARS
    ? `${stripped.slice(0, MAX_PROVIDER_MESSAGE_CHARS)}… [truncated]`
    : stripped;
}

export class LucidExecutor implements TxExecutor {
  readonly route: "l1" = "l1";

  #config: LucidExecutorConfig;
  #log: Logger;

  constructor(config: LucidExecutorConfig, log: Logger) {
    this.#config = config;
    this.#log = log;
    // Fail at wiring time rather than at submit time: an operator who points
    // cardafin at Mainnet without the confirmation should find out before a
    // request arrives, not while one is in flight.
    this.#assertMainnetConfirmed();
  }

  async execute(plan: TxPlan, signer: SignerRef): Promise<TxReceipt> {
    if (plan.route !== "l1") {
      throw new CardafinError(
        "PROVIDER_ERROR",
        `LucidExecutor executes route "l1", not "${plan.route}"`,
        { route: plan.route },
      );
    }
    if (plan.network !== this.#config.network) {
      throw new CardafinError(
        "PROVIDER_ERROR",
        `plan is for ${plan.network} but this executor is on ${this.#config.network}`,
        { planNetwork: plan.network, executorNetwork: this.#config.network },
      );
    }
    this.#assertMainnetConfirmed();

    try {
      const lucid = await Lucid(
        new Blockfrost(this.#config.blockfrostUrl, this.#config.projectId),
        this.#config.network,
      );
      lucid.selectWallet.fromSeed(signer.mnemonic, {
        accountIndex: signer.accountIndex,
        addressType: "Base",
      });

      const address = await lucid.wallet().address();
      if (address !== plan.from) {
        // Coin selection spends whatever the selected wallet holds. If that
        // is not the wallet the plan was funded against, the plan's funds
        // check means nothing — so this is a hard stop, not a warning.
        throw new CardafinError(
          "PROVIDER_ERROR",
          "plan was built for a different wallet than the signer derives",
          { accountIndex: signer.accountIndex, network: plan.network },
        );
      }

      // Lucid's TxBuilder methods mutate their shared config and return the
      // same object (verified in @lucid-evolution/lucid's `makeTxBuilder`),
      // so the builder `applyPlan` hands back is this one. Holding the
      // original reference keeps the full `TxBuilder` type — `applyPlan`
      // deals in the narrow `MinimalTxBuilder` and has no `.complete()`.
      const builder = lucid.newTx();
      applyPlan(builder, plan, {
        slotToUnixTime: (slot) => lucid.slotToUnixTime(slot),
        scriptFromNative,
      });

      const signBuilder = await builder.complete();
      const txHash = signBuilder.toHash();
      const fee = this.#feeOf(signBuilder.toTransaction(), plan);

      // Before submit, deliberately: if the submit call dies mid-flight the
      // operator still has the hash and can look the transaction up.
      this.#log.info("submitting", {
        kind: plan.kind,
        route: plan.route,
        network: plan.network,
        txHash,
        fee,
        description: describePlan(plan),
      });

      const signed = await signBuilder.sign.withWallet().complete();
      const submitted = await signed.submit();

      return {
        txHash: submitted,
        fee,
        route: "l1",
        explorerUrl: explorerTxUrl(this.#config.network, submitted),
      };
    } catch (e) {
      throw this.#wrap(e, plan);
    }
  }

  /**
   * The exact fee the node will charge, read off the built transaction body
   * (`CML.TransactionBody.fee()` is the balanced value lucid computed during
   * `.complete()`). Core's `estimateFee` is only a fallback for the case
   * where CML hands back something unreadable — a conservative estimate is
   * better in a receipt than a zero, and a receipt is not consensus.
   */
  #feeOf(tx: { body(): { fee(): bigint } }, plan: TxPlan): Lovelace {
    try {
      const fee = tx.body().fee();
      if (typeof fee === "bigint" && fee > 0n) {
        return fee;
      }
    } catch {
      // fall through to the estimate
    }
    // Core's estimate: minFeeA x heuristic size + minFeeB, the same number
    // `checkFunds` used to approve the plan a moment ago.
    const fallback = estimateFee(
      estimateSimpleTxBytes(
        plan.outputs.length + 1,
        1,
        plan.mint !== undefined,
        estimatePlanMetadataBytes(plan),
      ),
    );
    this.#log.warn("could not read the exact fee from the built transaction", {
      kind: plan.kind,
      estimatedFee: fallback,
    });
    return fallback;
  }

  #assertMainnetConfirmed(): void {
    if (isMainnet(this.#config.network) && this.#config.mainnetConfirmed !== true) {
      throw new CardafinError(
        "MAINNET_NOT_CONFIRMED",
        "refusing to build a Mainnet transaction: LucidExecutor was not constructed with mainnetConfirmed: true",
        { network: this.#config.network },
      );
    }
  }

  #wrap(e: unknown, plan: TxPlan): CardafinError {
    if (isCardafinError(e)) {
      return e;
    }
    const raw = e instanceof Error ? e.message : String(e);
    return new CardafinError(
      "PROVIDER_ERROR",
      `lucid failed to submit this ${plan.kind}: ${sanitiseProviderMessage(raw)}`,
      { kind: plan.kind, network: plan.network, route: plan.route },
    );
  }
}
