// env → typed Config. Pure: `loadConfig` takes the environment as a plain
// object argument and this module never reaches for the real one, which is
// what makes every rule below testable (and is asserted by config.test.ts).
// See docs/ARCHITECTURE.md §6.

import { CardafinError } from "./core/errors.ts";
import { fail } from "./core/errors.ts";
import type { Network } from "./core/network.ts";
import { blockfrostUrl, isMainnet, parseNetwork } from "./core/network.ts";
import type { Result } from "./core/result.ts";
import { ok } from "./core/result.ts";

export type Config = {
  network: Network;
  blockfrostProjectId: string;
  /** Derived from the network, never configured: they must not disagree. */
  blockfrostUrl: string;
  mnemonic: string;
  mainnetConfirmed: boolean;
  httpPort: number;
  apiKeys: string[];
};

/** The exact string `CARDAFIN_MAINNET_CONFIRM` must hold to touch Mainnet. */
export const MAINNET_CONFIRM_TOKEN = "I_UNDERSTAND_REAL_FUNDS";

/** The value shipped in `.env.example`; a copied-but-unedited file. */
export const PLACEHOLDER_PROJECT_ID = "YOUR_BLOCKFROST_KEY_HERE";

export const DEFAULT_NETWORK: Network = "Preview";
export const DEFAULT_HTTP_PORT = 8787;
export const MAX_PORT = 65535;

/** BIP-39 phrase lengths. Word *validity* is the KeyPort's business. */
export const MNEMONIC_WORD_COUNTS: readonly number[] = [12, 15, 18, 21, 24];

/**
 * Shell quoting survives `--env-file`: `CARDAFIN_MNEMONIC="abandon … art"`
 * can arrive with the quotes attached. Strip one matching pair.
 */
function stripQuotes(s: string): string {
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' || first === "'") && first === last) {
      return s.slice(1, -1);
    }
  }
  return s;
}

function countWords(s: string): number {
  return s.split(/\s+/).filter((w) => w !== "").length;
}

export function loadConfig(env: Record<string, string | undefined>): Result<Config> {
  const networkRaw = (env.CARDAFIN_NETWORK ?? "").trim();
  const network = networkRaw === "" ? ok(DEFAULT_NETWORK) : parseNetwork(networkRaw);
  if (!network.ok) {
    return network;
  }

  const projectId = stripQuotes((env.BLOCKFROST_PROJECT_ID ?? "").trim());
  if (projectId === "") {
    return fail(
      "INVALID_REQUEST",
      "BLOCKFROST_PROJECT_ID is required and must not be empty",
      { variable: "BLOCKFROST_PROJECT_ID" },
    );
  }
  if (projectId === PLACEHOLDER_PROJECT_ID) {
    return fail(
      "INVALID_REQUEST",
      `BLOCKFROST_PROJECT_ID is still the placeholder "${PLACEHOLDER_PROJECT_ID}" from .env.example: create a project at blockfrost.io for ${network.value} and paste its id`,
      { variable: "BLOCKFROST_PROJECT_ID" },
    );
  }

  const mnemonic = stripQuotes((env.CARDAFIN_MNEMONIC ?? "").trim()).trim();
  if (mnemonic === "") {
    return fail("INVALID_REQUEST", "CARDAFIN_MNEMONIC is required and must not be empty", {
      variable: "CARDAFIN_MNEMONIC",
    });
  }
  const words = countWords(mnemonic);
  if (!MNEMONIC_WORD_COUNTS.includes(words)) {
    return fail(
      "INVALID_REQUEST",
      `CARDAFIN_MNEMONIC must be ${MNEMONIC_WORD_COUNTS.join(", ")} words, got ${words}`,
      { variable: "CARDAFIN_MNEMONIC", words },
    );
  }

  const mainnetConfirmed =
    (env.CARDAFIN_MAINNET_CONFIRM ?? "").trim() === MAINNET_CONFIRM_TOKEN;
  if (isMainnet(network.value) && !mainnetConfirmed) {
    return fail(
      "MAINNET_NOT_CONFIRMED",
      `CARDAFIN_NETWORK=Mainnet moves real funds: set CARDAFIN_MAINNET_CONFIRM=${MAINNET_CONFIRM_TOKEN} to proceed`,
      { variable: "CARDAFIN_MAINNET_CONFIRM" },
    );
  }

  const portRaw = (env.CARDAFIN_HTTP_PORT ?? "").trim();
  let httpPort = DEFAULT_HTTP_PORT;
  if (portRaw !== "") {
    // Plain digits only. parseInt would read "80abc" as 80, and Number would
    // accept "1e4" and "0x50" — a port typo should be an error, not a guess.
    const parsed = /^\d+$/.test(portRaw) ? Number(portRaw) : Number.NaN;
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_PORT) {
      return fail(
        "INVALID_REQUEST",
        `CARDAFIN_HTTP_PORT must be a whole number between 1 and ${MAX_PORT}, got "${portRaw}"`,
        { variable: "CARDAFIN_HTTP_PORT" },
      );
    }
    httpPort = parsed;
  }

  const apiKeys = (env.CARDAFIN_API_KEYS ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k !== "");

  return ok({
    network: network.value,
    blockfrostProjectId: projectId,
    blockfrostUrl: blockfrostUrl(network.value),
    mnemonic,
    mainnetConfirmed,
    httpPort,
    apiKeys,
  });
}

/** Everything the logger must scrub. Order is irrelevant; duplicates are not. */
export function secretsOf(config: Config): string[] {
  return [config.mnemonic, config.blockfrostProjectId].filter(
    (s) => typeof s === "string" && s !== "",
  );
}

/**
 * The last gate before anything is submitted. `loadConfig` already refuses an
 * unconfirmed Mainnet, so this only fires for a Config built in code — but
 * every write path calls it anyway, because "real funds" deserves two checks.
 */
export function assertMainnetAllowed(config: Config): void {
  if (isMainnet(config.network) && !config.mainnetConfirmed) {
    throw new CardafinError(
      "MAINNET_NOT_CONFIRMED",
      `refusing to act on Mainnet without CARDAFIN_MAINNET_CONFIRM=${MAINNET_CONFIRM_TOKEN}`,
      { network: config.network },
    );
  }
}
