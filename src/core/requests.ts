// The client contract: turn `unknown` JSON into fully typed, bigint-normalised
// requests, or a CardafinError. Hand-rolled on purpose — core takes no
// dependency on a schema library. See docs/ARCHITECTURE.md §3.

import type { Result } from "./result.ts";
import { ok } from "./result.ts";
import { fail } from "./errors.ts";
import type { Lovelace } from "./ada.ts";
import { adaToLovelace, parseLovelace } from "./ada.ts";
import type { Assets, Unit } from "./assets.ts";
import { LOVELACE, assetNameToHex, parseAssets, validateAssetNameHex, validatePolicyId } from "./assets.ts";
import type { AddressInfo } from "./address.ts";
import { validateAddress } from "./address.ts";
import type { Json, Metadatum } from "./metadata.ts";
import { METADATUM_MAX_BYTES, chunkUtf8, toMetadatum } from "./metadata.ts";
import type { Network } from "./network.ts";

export type SendAdaRequest = {
  to: string;
  /** ADA as a decimal string ("1.5"), or explicit lovelace. */
  amount: string | { lovelace: string };
  hydra?: boolean;
  metadata?: Json;
};

export type CreatePolicyRequest = {
  lockBeforeSlot?: number;
  lockInSeconds?: number;
};

export type MintTokenRequest = {
  policyId: string;
  assetName: string;
  quantity: string;
  to?: string;
  cip25?: { name: string; image?: string; description?: string };
  hydra?: boolean;
};

export type SendTokensRequest = {
  to: string;
  assets: Record<Unit, string>;
  hydra?: boolean;
};

export type ValidSendAda = {
  to: AddressInfo;
  lovelace: Lovelace;
  hydra: boolean;
  /** Already shaped for label 674 (CIP-20). */
  metadata?: Metadatum;
};

export type ValidCreatePolicy = {
  /**
   * Absolute lock slot, when the caller gave one. It takes precedence over
   * `lockInSeconds`, which then holds the default and is unused.
   */
  lockBeforeSlot?: number;
  lockInSeconds: number;
};

export type ValidMint = {
  policyId: string;
  assetNameHex: string;
  assetName: string;
  quantity: bigint;
  to?: AddressInfo;
  cip25?: Cip25Request;
  hydra: boolean;
};

export type Cip25Request = {
  name: string;
  image?: string;
  description?: string;
  [k: string]: Json | undefined;
};

export type ValidSendTokens = {
  to: AddressInfo;
  /** Native assets only; "lovelace" is rejected at validation. */
  assets: Assets;
  hydra: boolean;
};

/** 1 slot == 1 second on Shelley-era Cardano. */
export const DEFAULT_POLICY_LOCK_SECONDS = 365 * 24 * 60 * 60;

function asRecord(input: unknown, what: string): Result<Record<string, unknown>> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return fail("INVALID_REQUEST", `${what} must be a JSON object`);
  }
  return ok(input as Record<string, unknown>);
}

function rejectUnknownKeys(
  body: Record<string, unknown>,
  allowed: readonly string[],
  what: string,
): Result<true> {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) {
      return fail(
        "INVALID_REQUEST",
        `${what} has an unknown field "${key}"; allowed: ${allowed.join(", ")}`,
        { field: key, allowed },
      );
    }
  }
  return ok(true);
}

function parseHydra(value: unknown): Result<boolean> {
  if (value === undefined) {
    return ok(false);
  }
  if (typeof value !== "boolean") {
    return fail("INVALID_REQUEST", "`hydra` must be a boolean");
  }
  return ok(value);
}

function requireAddress(
  value: unknown,
  network: Network,
  field: string,
): Result<AddressInfo> {
  if (typeof value !== "string" || value.trim() === "") {
    return fail("INVALID_REQUEST", `\`${field}\` must be a non-empty address string`);
  }
  return validateAddress(value, network);
}

/**
 * CIP-20 puts a free-text memo under label 674 as `{ msg: [chunk, ...] }`.
 * A string input is chunked that way; anything else is converted verbatim so
 * callers can send a structured metadatum.
 */
export function messageMetadatum(metadata: Json): Result<Metadatum> {
  if (typeof metadata === "string") {
    return ok({ msg: chunkUtf8(metadata, METADATUM_MAX_BYTES) });
  }
  return toMetadatum(metadata);
}

function parseAmount(value: unknown): Result<Lovelace> {
  if (typeof value === "string") {
    return adaToLovelace(value);
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const unknownKey = rejectUnknownKeys(obj, ["lovelace"], "`amount`");
    if (!unknownKey.ok) {
      return unknownKey;
    }
    const lovelace = obj.lovelace;
    if (lovelace === undefined) {
      return fail("INVALID_REQUEST", "`amount` object must have a `lovelace` field");
    }
    if (
      typeof lovelace !== "string" &&
      typeof lovelace !== "number" &&
      typeof lovelace !== "bigint"
    ) {
      return fail("INVALID_AMOUNT", "`amount.lovelace` must be a string, number or bigint");
    }
    return parseLovelace(lovelace);
  }
  return fail(
    "INVALID_REQUEST",
    '`amount` must be an ADA decimal string ("1.5") or { lovelace: "1500000" }',
  );
}

export function validateSendAda(input: unknown, network: Network): Result<ValidSendAda> {
  const body = asRecord(input, "send-ada request");
  if (!body.ok) {
    return body;
  }
  const unknownKey = rejectUnknownKeys(
    body.value,
    ["to", "amount", "hydra", "metadata"],
    "send-ada request",
  );
  if (!unknownKey.ok) {
    return unknownKey;
  }

  const to = requireAddress(body.value.to, network, "to");
  if (!to.ok) {
    return to;
  }
  if (body.value.amount === undefined) {
    return fail("INVALID_REQUEST", "send-ada request requires `amount`");
  }
  const lovelace = parseAmount(body.value.amount);
  if (!lovelace.ok) {
    return lovelace;
  }
  const hydra = parseHydra(body.value.hydra);
  if (!hydra.ok) {
    return hydra;
  }

  const out: ValidSendAda = { to: to.value, lovelace: lovelace.value, hydra: hydra.value };
  if (body.value.metadata !== undefined) {
    const metadata = messageMetadatum(body.value.metadata as Json);
    if (!metadata.ok) {
      return metadata;
    }
    out.metadata = metadata.value;
  }
  return ok(out);
}

export function validateCreatePolicy(input: unknown): Result<ValidCreatePolicy> {
  const body = asRecord(input ?? {}, "create-policy request");
  if (!body.ok) {
    return body;
  }
  const unknownKey = rejectUnknownKeys(
    body.value,
    ["lockBeforeSlot", "lockInSeconds"],
    "create-policy request",
  );
  if (!unknownKey.ok) {
    return unknownKey;
  }

  const slot = body.value.lockBeforeSlot;
  const seconds = body.value.lockInSeconds;
  if (slot !== undefined && seconds !== undefined) {
    return fail(
      "INVALID_REQUEST",
      "give either `lockBeforeSlot` or `lockInSeconds`, not both",
    );
  }
  if (slot !== undefined) {
    if (typeof slot !== "number" || !Number.isSafeInteger(slot) || slot < 0) {
      return fail(
        "INVALID_REQUEST",
        "`lockBeforeSlot` must be a non-negative whole number",
      );
    }
    return ok({ lockBeforeSlot: slot, lockInSeconds: DEFAULT_POLICY_LOCK_SECONDS });
  }
  if (seconds !== undefined) {
    if (typeof seconds !== "number" || !Number.isSafeInteger(seconds) || seconds <= 0) {
      return fail("INVALID_REQUEST", "`lockInSeconds` must be a whole number > 0");
    }
    return ok({ lockInSeconds: seconds });
  }
  return ok({ lockInSeconds: DEFAULT_POLICY_LOCK_SECONDS });
}

function parseCip25(value: unknown): Result<Cip25Request> {
  const body = asRecord(value, "`cip25`");
  if (!body.ok) {
    return body;
  }
  const name = body.value.name;
  if (typeof name !== "string" || name === "") {
    return fail("INVALID_REQUEST", "`cip25.name` is required and must be a non-empty string");
  }
  const out: Cip25Request = { name };
  for (const [key, raw] of Object.entries(body.value)) {
    if (key === "name" || raw === undefined) {
      continue;
    }
    // Validate it converts; store the original Json so cip25Metadata can
    // chunk long URIs itself.
    const converted = toMetadatum(raw as Json);
    if (!converted.ok) {
      return converted;
    }
    out[key] = raw as Json;
  }
  return ok(out);
}

export function validateMint(input: unknown, network: Network): Result<ValidMint> {
  const body = asRecord(input, "mint request");
  if (!body.ok) {
    return body;
  }
  const unknownKey = rejectUnknownKeys(
    body.value,
    ["policyId", "assetName", "assetNameHex", "quantity", "to", "cip25", "hydra"],
    "mint request",
  );
  if (!unknownKey.ok) {
    return unknownKey;
  }

  const policyIdRaw = body.value.policyId;
  if (typeof policyIdRaw !== "string") {
    return fail("INVALID_REQUEST", "`policyId` must be a string");
  }
  const policyId = validatePolicyId(policyIdRaw);
  if (!policyId.ok) {
    return policyId;
  }

  const nameRaw = body.value.assetName;
  const nameHexRaw = body.value.assetNameHex;
  let assetNameHex: string;
  let assetName: string;
  if (typeof nameHexRaw === "string" && nameRaw === undefined) {
    const hex = validateAssetNameHex(nameHexRaw);
    if (!hex.ok) {
      return hex;
    }
    assetNameHex = hex.value;
    assetName = nameHexRaw;
  } else if (typeof nameRaw === "string") {
    if (nameHexRaw !== undefined) {
      return fail(
        "INVALID_REQUEST",
        "give either `assetName` or `assetNameHex`, not both",
      );
    }
    const hex = assetNameToHex(nameRaw);
    if (!hex.ok) {
      return hex;
    }
    assetNameHex = hex.value;
    assetName = nameRaw;
  } else {
    return fail("INVALID_REQUEST", "`assetName` must be a string");
  }

  const quantityRaw = body.value.quantity;
  if (
    typeof quantityRaw !== "string" &&
    typeof quantityRaw !== "number" &&
    typeof quantityRaw !== "bigint"
  ) {
    return fail("INVALID_REQUEST", "`quantity` must be a string, number or bigint");
  }
  const quantity = parseLovelace(quantityRaw);
  if (!quantity.ok) {
    return fail("INVALID_AMOUNT", `\`quantity\` is invalid: ${quantity.error.message}`);
  }
  if (quantity.value <= 0n) {
    return fail("INVALID_AMOUNT", "`quantity` must be > 0");
  }

  const hydra = parseHydra(body.value.hydra);
  if (!hydra.ok) {
    return hydra;
  }

  const out: ValidMint = {
    policyId: policyId.value,
    assetNameHex,
    assetName,
    quantity: quantity.value,
    hydra: hydra.value,
  };

  if (body.value.to !== undefined) {
    const to = requireAddress(body.value.to, network, "to");
    if (!to.ok) {
      return to;
    }
    out.to = to.value;
  }
  if (body.value.cip25 !== undefined) {
    const cip25 = parseCip25(body.value.cip25);
    if (!cip25.ok) {
      return cip25;
    }
    out.cip25 = cip25.value;
  }
  return ok(out);
}

export function validateSendTokens(
  input: unknown,
  network: Network,
): Result<ValidSendTokens> {
  const body = asRecord(input, "send-tokens request");
  if (!body.ok) {
    return body;
  }
  const unknownKey = rejectUnknownKeys(
    body.value,
    ["to", "assets", "hydra"],
    "send-tokens request",
  );
  if (!unknownKey.ok) {
    return unknownKey;
  }

  const to = requireAddress(body.value.to, network, "to");
  if (!to.ok) {
    return to;
  }

  const assetsRaw = body.value.assets;
  const assetsRecord = asRecord(assetsRaw, "`assets`");
  if (!assetsRecord.ok) {
    return assetsRecord;
  }
  if (Object.keys(assetsRecord.value).length === 0) {
    return fail("INVALID_REQUEST", "`assets` must contain at least one unit");
  }
  if (LOVELACE in assetsRecord.value) {
    return fail(
      "INVALID_REQUEST",
      "`assets` must not contain lovelace: use send-ada to move ADA",
    );
  }
  const assets = parseAssets(
    assetsRecord.value as Record<string, string | number | bigint>,
  );
  if (!assets.ok) {
    return assets;
  }

  const hydra = parseHydra(body.value.hydra);
  if (!hydra.ok) {
    return hydra;
  }
  return ok({ to: to.value, assets: assets.value, hydra: hydra.value });
}
