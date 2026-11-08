// Native (Timelock/multisig) scripts: the policies cardafin mints under.
// The policy *id* is blake2b-224 of the script's CBOR, which core cannot
// compute without a dependency — it comes through `KeyPort` (see
// docs/ARCHITECTURE.md §4). Core owns the shape and the time-lock logic.

import type { Result } from "./result.ts";
import { ok } from "./result.ts";
import { fail } from "./errors.ts";

export type NativeScript =
  | { type: "sig"; keyHash: string }
  | { type: "before"; slot: number }
  | { type: "after"; slot: number }
  | { type: "all" | "any"; scripts: NativeScript[] }
  | { type: "atLeast"; required: number; scripts: NativeScript[] };

const KEY_HASH_RE = /^[0-9a-f]{56}$/;

/** The one policy shape v1 creates: one signer, locked after `beforeSlot`. */
export function sigAndBeforePolicy(keyHash: string, beforeSlot: number): NativeScript {
  return {
    type: "all",
    scripts: [
      { type: "sig", keyHash },
      { type: "before", slot: beforeSlot },
    ],
  };
}

/**
 * Evaluate only the time-lock clauses at `slot`. Signature clauses are
 * treated as satisfiable (true) because core has no witnesses: this answers
 * "could this policy still be used at that slot?", not "is this tx valid?".
 *
 * `before` is open while currentSlot < slot (the ledger's `invalid_hereafter`
 * sense); `after` is open once currentSlot >= slot.
 */
export function policyIsOpenAt(script: NativeScript, slot: number): boolean {
  switch (script.type) {
    case "sig":
      return true;
    case "before":
      return slot < script.slot;
    case "after":
      return slot >= script.slot;
    case "all":
      return script.scripts.every((s) => policyIsOpenAt(s, slot));
    case "any":
      return script.scripts.some((s) => policyIsOpenAt(s, slot));
    case "atLeast": {
      let open = 0;
      for (const s of script.scripts) {
        if (policyIsOpenAt(s, slot)) {
          open++;
        }
      }
      return open >= script.required;
    }
  }
}

/**
 * The smallest `before` slot anywhere in the script — the slot at which the
 * policy certainly stops minting. `undefined` when the policy never expires.
 */
export function earliestBeforeSlot(script: NativeScript): number | undefined {
  switch (script.type) {
    case "before":
      return script.slot;
    case "sig":
    case "after":
      return undefined;
    case "all":
    case "any":
    case "atLeast": {
      let best: number | undefined;
      for (const s of script.scripts) {
        const found = earliestBeforeSlot(s);
        if (found !== undefined && (best === undefined || found < best)) {
          best = found;
        }
      }
      return best;
    }
  }
}

/** All distinct key hashes referenced by the script, sorted. */
export function keyHashesOf(script: NativeScript): string[] {
  const out = new Set<string>();
  collectKeyHashes(script, out);
  return [...out].sort();
}

function collectKeyHashes(script: NativeScript, into: Set<string>): void {
  if (script.type === "sig") {
    into.add(script.keyHash);
    return;
  }
  if (script.type === "all" || script.type === "any" || script.type === "atLeast") {
    for (const s of script.scripts) {
      collectKeyHashes(s, into);
    }
  }
}

function isSlot(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}

/** Shape-check an untrusted script recursively. */
export function validateNativeScript(s: unknown): Result<NativeScript> {
  return check(s, "script");
}

function check(s: unknown, path: string): Result<NativeScript> {
  if (s === null || typeof s !== "object" || Array.isArray(s)) {
    return fail("INVALID_REQUEST", `${path} must be an object`);
  }
  const node = s as Record<string, unknown>;
  const type = node.type;
  if (typeof type !== "string") {
    return fail("INVALID_REQUEST", `${path}.type must be a string`);
  }
  switch (type) {
    case "sig": {
      const keyHash = node.keyHash;
      if (typeof keyHash !== "string" || !KEY_HASH_RE.test(keyHash)) {
        return fail(
          "INVALID_REQUEST",
          `${path}.keyHash must be 56 lowercase hex characters`,
        );
      }
      return ok({ type: "sig", keyHash });
    }
    case "before":
    case "after": {
      if (!isSlot(node.slot)) {
        return fail(
          "INVALID_REQUEST",
          `${path}.slot must be a non-negative whole number`,
        );
      }
      return ok({ type, slot: node.slot });
    }
    case "all":
    case "any": {
      const scripts = checkChildren(node.scripts, path);
      if (!scripts.ok) {
        return scripts;
      }
      return ok({ type, scripts: scripts.value });
    }
    case "atLeast": {
      const scripts = checkChildren(node.scripts, path);
      if (!scripts.ok) {
        return scripts;
      }
      const required = node.required;
      if (typeof required !== "number" || !Number.isSafeInteger(required) || required < 1) {
        return fail(
          "INVALID_REQUEST",
          `${path}.required must be a whole number >= 1`,
        );
      }
      if (required > scripts.value.length) {
        return fail(
          "INVALID_REQUEST",
          `${path}.required (${required}) exceeds the ${scripts.value.length} sub-scripts`,
        );
      }
      return ok({ type: "atLeast", required, scripts: scripts.value });
    }
    default:
      return fail("INVALID_REQUEST", `${path}.type "${type}" is not a native script type`);
  }
}

function checkChildren(value: unknown, path: string): Result<NativeScript[]> {
  if (!Array.isArray(value)) {
    return fail("INVALID_REQUEST", `${path}.scripts must be an array`);
  }
  // An empty `all` is vacuously true and an empty `any` is unusable; neither
  // is ever intended, so both are rejected.
  if (value.length === 0) {
    return fail("INVALID_REQUEST", `${path}.scripts must not be empty`);
  }
  const out: NativeScript[] = [];
  for (let i = 0; i < value.length; i++) {
    const child = check(value[i], `${path}.scripts[${i}]`);
    if (!child.ok) {
      return child;
    }
    out.push(child.value);
  }
  return ok(out);
}
