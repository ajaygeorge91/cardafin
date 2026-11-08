// TxPlan: a network-free, key-free description of what a transaction must do.
// Services build plans; executors (memory / lucid / later hydra) turn plans
// into transactions. This is what lets `hydra: true` route differently
// without changing the client contract. See docs/ARCHITECTURE.md §3.

import type { Result } from "./result.ts";
import { ok } from "./result.ts";
import { fail } from "./errors.ts";
import type { Lovelace } from "./ada.ts";
import { formatAda } from "./ada.ts";
import type { Assets } from "./assets.ts";
import {
  LOVELACE,
  addAssets,
  lovelaceOf,
  nativeAssetsOf,
  subtractAssets,
  toUnit,
} from "./assets.ts";
import { truncateAddress } from "./address.ts";
import type { Metadatum } from "./metadata.ts";
import {
  METADATA_LABEL_CIP25,
  METADATA_LABEL_MESSAGE,
  cip25Metadata,
} from "./metadata.ts";
import type { Network } from "./network.ts";
import type { ProtocolParams } from "./fees.ts";
import {
  CONWAY_DEFAULT_PARAMS,
  estimateFee,
  estimateMinAda,
  estimateSimpleTxBytes,
} from "./fees.ts";
import type { NativeScript } from "./native-script.ts";
import { earliestBeforeSlot } from "./native-script.ts";
import type { ValidMint, ValidSendAda, ValidSendTokens } from "./requests.ts";

export type TxOutput = { address: string; assets: Assets };

export type TxPlan = {
  kind: "send-ada" | "mint" | "send-tokens";
  network: Network;
  route: "l1" | "hydra";
  /** The wallet payment address funding the transaction. */
  from: string;
  outputs: TxOutput[];
  /** Negative quantities are burns. */
  mint?: { script: NativeScript; policyId: string; assets: Assets };
  validToSlot?: number;
  metadata?: Array<{ label: number; value: Metadatum }>;
};

export type PlanContext = {
  network: Network;
  from: string;
  available: Assets;
  currentSlot: number;
  params: ProtocolParams;
};

export type PolicyInfo = {
  policyId: string;
  script: NativeScript;
  keyHash: string;
  lockBeforeSlot?: number;
};

/** Two hours of slots (1 slot == 1 second), the default validity window. */
export const MINT_VALIDITY_WINDOW_SLOTS = 7200;

function route(hydra: boolean): "l1" | "hydra" {
  return hydra ? "hydra" : "l1";
}

function belowMinAda(
  address: string,
  assets: Assets,
  params: ProtocolParams,
): Result<true> {
  const minimum = estimateMinAda(assets, params);
  const have = lovelaceOf(assets);
  if (have >= minimum) {
    return ok(true);
  }
  return fail(
    "BELOW_MIN_ADA",
    `output of ${formatAda(have)} is below the estimated minimum of ${formatAda(minimum)}`,
    { minimum, provided: have, address: truncateAddress(address) },
  );
}

export function planSendAda(req: ValidSendAda, ctx: PlanContext): Result<TxPlan> {
  const assets: Assets = { [LOVELACE]: req.lovelace };
  const minAda = belowMinAda(req.to.bech32, assets, ctx.params);
  if (!minAda.ok) {
    return minAda;
  }
  const plan: TxPlan = {
    kind: "send-ada",
    network: ctx.network,
    route: route(req.hydra),
    from: ctx.from,
    outputs: [{ address: req.to.bech32, assets }],
  };
  if (req.metadata !== undefined) {
    plan.metadata = [{ label: METADATA_LABEL_MESSAGE, value: req.metadata }];
  }
  return ok(plan);
}

/**
 * Token transfers carry ADA whether the recipient wants it or not: every
 * output must satisfy min-ADA. cardafin makes the **sender** pay exactly the
 * estimated minimum rather than asking the caller for an ADA amount, so a
 * token send has one knob instead of two.
 */
export function planSendTokens(req: ValidSendTokens, ctx: PlanContext): Result<TxPlan> {
  const tokens = nativeAssetsOf(req.assets);
  if (Object.keys(tokens).length === 0) {
    return fail("INVALID_REQUEST", "send-tokens requires at least one native asset");
  }
  const minAda = estimateMinAda(tokens, ctx.params);
  const assets = addAssets(tokens, { [LOVELACE]: minAda });
  const check = belowMinAda(req.to.bech32, assets, ctx.params);
  if (!check.ok) {
    return check;
  }
  return ok({
    kind: "send-tokens",
    network: ctx.network,
    route: route(req.hydra),
    from: ctx.from,
    outputs: [{ address: req.to.bech32, assets }],
  });
}

export function planMint(
  req: ValidMint,
  policy: PolicyInfo,
  ctx: PlanContext,
): Result<TxPlan> {
  if (policy.policyId !== req.policyId) {
    return fail(
      "INVALID_REQUEST",
      `policy id mismatch: request asks for ${req.policyId}, policy is ${policy.policyId}`,
      { requested: req.policyId, policy: policy.policyId },
    );
  }

  const unit = toUnit(req.policyId, req.assetNameHex);
  if (!unit.ok) {
    return unit;
  }
  const minted: Assets = { [unit.value]: req.quantity };

  // `lockBeforeSlot` is authoritative when present; fall back to the script
  // itself so an inconsistent PolicyInfo still produces a safe window.
  const lockBeforeSlot = policy.lockBeforeSlot ?? earliestBeforeSlot(policy.script);
  let validToSlot: number | undefined;
  if (lockBeforeSlot !== undefined) {
    if (ctx.currentSlot >= lockBeforeSlot) {
      return fail(
        "INVALID_REQUEST",
        `policy is locked: it closed at slot ${lockBeforeSlot} and the chain is at slot ${ctx.currentSlot}`,
        { lockBeforeSlot, currentSlot: ctx.currentSlot },
      );
    }
    validToSlot = Math.min(
      lockBeforeSlot - 1,
      ctx.currentSlot + MINT_VALIDITY_WINDOW_SLOTS,
    );
    if (validToSlot <= ctx.currentSlot) {
      return fail(
        "INVALID_REQUEST",
        `policy closes at slot ${lockBeforeSlot}, leaving no validity window after slot ${ctx.currentSlot}`,
        { lockBeforeSlot, currentSlot: ctx.currentSlot },
      );
    }
  }

  const address = req.to?.bech32 ?? ctx.from;
  const minAda = estimateMinAda(minted, ctx.params);
  const assets = addAssets(minted, { [LOVELACE]: minAda });
  const check = belowMinAda(address, assets, ctx.params);
  if (!check.ok) {
    return check;
  }

  const plan: TxPlan = {
    kind: "mint",
    network: ctx.network,
    route: route(req.hydra),
    from: ctx.from,
    outputs: [{ address, assets }],
    mint: { script: policy.script, policyId: policy.policyId, assets: minted },
  };
  if (validToSlot !== undefined) {
    plan.validToSlot = validToSlot;
  }
  if (req.cip25 !== undefined) {
    const metadata = cip25Metadata(req.policyId, req.assetNameHex, req.cip25);
    if (!metadata.ok) {
      return metadata;
    }
    plan.metadata = [{ label: METADATA_LABEL_CIP25, value: metadata.value }];
  }
  return ok(plan);
}

/** Heuristic serialised size of a metadatum, for the fee estimate. */
function metadatumBytes(value: Metadatum): number {
  if (typeof value === "string") {
    return new TextEncoder().encode(value).length + 2;
  }
  if (typeof value === "bigint") {
    return 9;
  }
  if (Array.isArray(value)) {
    let total = 2;
    for (const item of value) {
      total += metadatumBytes(item);
    }
    return total;
  }
  let total = 2;
  for (const [key, item] of Object.entries(value)) {
    total += new TextEncoder().encode(key).length + 2 + metadatumBytes(item);
  }
  return total;
}

export function estimatePlanMetadataBytes(plan: TxPlan): number {
  let total = 0;
  for (const entry of plan.metadata ?? []) {
    total += 8 + metadatumBytes(entry.value);
  }
  return total;
}

/**
 * Can `available` pay for this plan? Required = every output's assets, minus
 * what the plan mints (newly minted tokens do not come from the wallet; a
 * burn, i.e. a negative mint quantity, does), plus the estimated fee.
 * One change output and one input are assumed for the size estimate.
 */
export function checkFunds(
  plan: TxPlan,
  available: Assets,
  params: ProtocolParams = CONWAY_DEFAULT_PARAMS,
): Result<{ estimatedFee: Lovelace; minAdaPerOutput: Lovelace[] }> {
  let required: Assets = {};
  for (const output of plan.outputs) {
    required = addAssets(required, output.assets);
  }
  if (plan.mint) {
    for (const [unit, qty] of Object.entries(plan.mint.assets)) {
      if (unit === LOVELACE) {
        continue;
      }
      if (qty > 0n) {
        const have = required[unit] ?? 0n;
        const next = have - qty;
        if (next > 0n) {
          required[unit] = next;
        } else {
          delete required[unit];
        }
      } else if (qty < 0n) {
        required = addAssets(required, { [unit]: -qty });
      }
    }
  }

  const sizeBytes = estimateSimpleTxBytes(
    plan.outputs.length + 1,
    1,
    plan.mint !== undefined,
    estimatePlanMetadataBytes(plan),
  );
  const estimatedFee = estimateFee(sizeBytes, params);
  required = addAssets(required, { [LOVELACE]: estimatedFee });

  const remaining = subtractAssets(available, required);
  if (!remaining.ok) {
    return fail(
      "INSUFFICIENT_FUNDS",
      `wallet cannot cover this plan: needs ${formatAda(lovelaceOf(required))} plus tokens`,
      { required, available, estimatedFee },
    );
  }

  const minAdaPerOutput = plan.outputs.map((o) => estimateMinAda(o.assets, params));
  return ok({ estimatedFee, minAdaPerOutput });
}

function describeAssets(assets: Assets): string {
  const parts: string[] = [];
  const ada = lovelaceOf(assets);
  if (ada !== 0n) {
    parts.push(formatAda(ada));
  }
  const units = Object.keys(assets)
    .filter((u) => u !== LOVELACE)
    .sort();
  for (const unit of units) {
    parts.push(`${assets[unit] ?? 0n} ${unit}`);
  }
  return parts.length > 0 ? parts.join(" + ") : "nothing";
}

/**
 * One human line for logs. Contains only: kind, route, network, amounts,
 * units, truncated addresses, policy id and slots. Never a key, a mnemonic,
 * a witness or CBOR.
 */
export function describePlan(plan: TxPlan): string {
  const head = `${plan.kind} via ${plan.route} on ${plan.network}`;
  const parts: string[] = [];
  for (const output of plan.outputs) {
    parts.push(`${describeAssets(output.assets)} → ${truncateAddress(output.address)}`);
  }
  if (plan.mint) {
    parts.push(`mint ${describeAssets(plan.mint.assets)} under policy ${plan.mint.policyId}`);
  }
  if (plan.validToSlot !== undefined) {
    parts.push(`validTo slot ${plan.validToSlot}`);
  }
  const labels = (plan.metadata ?? []).map((m) => m.label);
  if (labels.length > 0) {
    parts.push(`metadata labels ${labels.join(", ")}`);
  }
  return `${head}: ${parts.join("; ")}`;
}
