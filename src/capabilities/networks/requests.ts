// The client contract for networks: parse and validate untrusted input into
// core types. Pure — no ports, no clock, no IO. Unknown fields are rejected
// rather than ignored, the same rule the rest of the service keeps.

import type { Result } from "../../core/result.ts";
import { err, ok } from "../../core/result.ts";
import { CardafinError } from "../../core/errors.ts";

export type NetworksRequest = {
  /** Replace with the real contract. Kept so the scaffold typechecks. */
  readonly placeholder?: string;
};

const ALLOWED_FIELDS: readonly string[] = ["placeholder"];

export function parseNetworksRequest(input: unknown): Result<NetworksRequest> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return err(new CardafinError("INVALID_REQUEST", "networks: body must be a JSON object"));
  }

  const unknownFields = Object.keys(input).filter((k) => !ALLOWED_FIELDS.includes(k));
  if (unknownFields.length > 0) {
    return err(
      new CardafinError("INVALID_REQUEST", `networks: unknown field(s) ${unknownFields.join(", ")}`, {
        unknownFields,
      }),
    );
  }

  return ok(input as NetworksRequest);
}
