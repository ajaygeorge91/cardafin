// TxService: the write half of cardafin's use cases. Every method is the same
// pipeline, which is the point — there is one place where a transaction can
// be planned, funded, authorised and submitted.
//
//   validate (core)
//     → derive the wallet
//     → read balance, slot and protocol params
//     → build a TxPlan (core)
//     → checkFunds (core)
//     → assertMainnetAllowed (config)
//     → log describePlan
//     → router.for(plan.route).execute(plan, signer)
//     → log the receipt
//
// Depends on core + ports only. See docs/ARCHITECTURE.md §5.

import { CardafinError } from "../core/errors.ts";
import type { PlanContext, PolicyInfo, TxPlan } from "../core/plan.ts";
import {
  checkFunds,
  describePlan,
  planMint,
  planSendAda,
  planSendTokens,
} from "../core/plan.ts";
import { sigAndBeforePolicy } from "../core/native-script.ts";
import {
  validateCreatePolicy,
  validateMint,
  validateSendAda,
  validateSendTokens,
} from "../core/requests.ts";
import type { Result } from "../core/result.ts";
import { unwrap } from "../core/result.ts";
import type { ChainReader } from "../ports/chain.ts";
import type { TxReceipt } from "../ports/executor.ts";
import type { KeyPort } from "../ports/keys.ts";
import type { Logger } from "../ports/logger.ts";
import type { Config } from "../config.ts";
import { assertMainnetAllowed } from "../config.ts";
import type { TxRouter } from "./router.ts";

export type TxServiceDeps = {
  keys: KeyPort;
  chain: ChainReader;
  router: TxRouter;
  config: Config;
  log: Logger;
};

export class TxService {
  #keys: KeyPort;
  #chain: ChainReader;
  #router: TxRouter;
  #config: Config;
  #log: Logger;

  constructor(deps: TxServiceDeps) {
    this.#keys = deps.keys;
    this.#chain = deps.chain;
    this.#router = deps.router;
    this.#config = deps.config;
    this.#log = deps.log;
  }

  async sendAda(input: unknown, accountIndex = 0): Promise<TxReceipt> {
    const req = unwrap(validateSendAda(input, this.#config.network));
    return this.#submit(accountIndex, (ctx) => planSendAda(req, ctx));
  }

  async sendTokens(input: unknown, accountIndex = 0): Promise<TxReceipt> {
    const req = unwrap(validateSendTokens(input, this.#config.network));
    return this.#submit(accountIndex, (ctx) => planSendTokens(req, ctx));
  }

  /**
   * `policy` is passed in, not looked up: TxService is stateless and cardafin
   * v1 has no policy registry. **The caller keeps the PolicyInfo JSON** —
   * script, policy id, key hash and lock slot. Lose it and the tokens can
   * never be minted or burned again, because the script is unrecoverable from
   * the policy id alone. A persisted registry is a later concern.
   */
  async mint(input: unknown, policy: PolicyInfo, accountIndex = 0): Promise<TxReceipt> {
    const req = unwrap(validateMint(input, this.#config.network));
    return this.#submit(accountIndex, (ctx) => planMint(req, policy, ctx));
  }

  /**
   * Create a time-locked, single-signer minting policy. No transaction is
   * built or submitted: a native-script policy exists the moment its script
   * does, and only appears on chain when something mints under it.
   */
  async createPolicy(input: unknown, accountIndex = 0): Promise<PolicyInfo> {
    const req = unwrap(validateCreatePolicy(input));
    const wallet = await this.#keys.deriveWallet(
      this.#config.mnemonic,
      accountIndex,
      this.#config.network,
    );
    const currentSlot = await this.#chain.getCurrentSlot();
    // One slot is one second on Preview, Preprod and Mainnet (the Shelley-era
    // slot length is 1 s on all three), so seconds and slots are the same
    // number and `lockInSeconds` can be added to a slot directly.
    const lockBeforeSlot = req.lockBeforeSlot ?? currentSlot + req.lockInSeconds;
    const script = sigAndBeforePolicy(wallet.paymentKeyHash, lockBeforeSlot);
    const policyId = this.#keys.nativeScriptPolicyId(script);
    // Safe to log: a policy id and a slot are public, and a payment key hash
    // is already visible in the wallet's address.
    this.#log.info("policy created", { policyId, lockBeforeSlot, currentSlot });
    return { policyId, script, keyHash: wallet.paymentKeyHash, lockBeforeSlot };
  }

  async #submit(
    accountIndex: number,
    build: (ctx: PlanContext) => Result<TxPlan>,
  ): Promise<TxReceipt> {
    const wallet = await this.#keys.deriveWallet(
      this.#config.mnemonic,
      accountIndex,
      this.#config.network,
    );
    if (wallet.network !== this.#config.network) {
      throw new CardafinError(
        "WRONG_NETWORK",
        `key provider derived a ${wallet.network} wallet but this service is on ${this.#config.network}`,
      );
    }

    const [available, currentSlot, params] = await Promise.all([
      this.#chain.getBalance(wallet.address),
      this.#chain.getCurrentSlot(),
      this.#chain.getProtocolParams(),
    ]);

    const plan = unwrap(
      build({
        network: this.#config.network,
        from: wallet.address,
        available,
        currentSlot,
        params,
      }),
    );
    const funds = unwrap(checkFunds(plan, available, params));

    assertMainnetAllowed(this.#config);

    this.#log.info(describePlan(plan), {
      kind: plan.kind,
      route: plan.route,
      network: plan.network,
      estimatedFee: funds.estimatedFee,
    });

    const receipt = await this.#router
      .for(plan.route)
      .execute(plan, { mnemonic: this.#config.mnemonic, accountIndex });

    this.#log.info("submitted", {
      txHash: receipt.txHash,
      fee: receipt.fee,
      explorerUrl: receipt.explorerUrl,
    });
    return receipt;
  }
}
