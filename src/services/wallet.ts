// WalletService: the read-only half of cardafin's use cases — create and
// restore a wallet, derive an address, read a balance, list UTxOs. Depends on
// core and ports only; never on an adapter. See docs/ARCHITECTURE.md §5.

import { lovelaceToAda } from "../core/ada.ts";
import { validateAddress } from "../core/address.ts";
import type { Assets, Unit } from "../core/assets.ts";
import { LOVELACE, fromUnit, lovelaceOf } from "../core/assets.ts";
import { CardafinError } from "../core/errors.ts";
import type { Utxo } from "../core/types.ts";
import type { ChainReader } from "../ports/chain.ts";
import type { KeyPort, WalletInfo } from "../ports/keys.ts";
import type { Config } from "../config.ts";

export type TokenBalance = {
  unit: Unit;
  policyId: string;
  assetNameHex: string;
  /** Lossy UTF-8 decode of the asset name, for display only. */
  assetName: string;
  /** Decimal string: JSON has no bigint. */
  quantity: string;
};

export type BalanceReport = {
  assets: Assets;
  /** Lovelace rendered as ADA, e.g. "7.831419". */
  ada: string;
  tokens: TokenBalance[];
};

export type WalletServiceDeps = {
  keys: KeyPort;
  chain: ChainReader;
  config: Config;
};

export class WalletService {
  #keys: KeyPort;
  #chain: ChainReader;
  #config: Config;

  constructor(deps: WalletServiceDeps) {
    this.#keys = deps.keys;
    this.#chain = deps.chain;
    this.#config = deps.config;
  }

  /**
   * A fresh mnemonic. It is returned once and **never persisted**: cardafin
   * has no wallet store, so whatever calls this is responsible for keeping
   * the words. Losing them loses the funds.
   */
  create(): { mnemonic: string } {
    return { mnemonic: this.#keys.generateMnemonic() };
  }

  async restore(mnemonic: string, accountIndex = 0): Promise<WalletInfo> {
    if (!this.#keys.validateMnemonic(mnemonic)) {
      throw new CardafinError(
        "INVALID_REQUEST",
        "mnemonic is not valid for this key provider",
      );
    }
    return this.#keys.deriveWallet(mnemonic, accountIndex, this.#config.network);
  }

  /** The service's own wallet, from `config.mnemonic`. */
  async address(accountIndex = 0): Promise<WalletInfo> {
    return this.#keys.deriveWallet(
      this.#config.mnemonic,
      accountIndex,
      this.#config.network,
    );
  }

  async balance(address: string): Promise<BalanceReport> {
    const assets = await this.#chain.getBalance(this.#requireAddress(address));
    return {
      assets,
      ada: lovelaceToAda(lovelaceOf(assets)),
      tokens: tokensOf(assets),
    };
  }

  async utxos(address: string): Promise<Utxo[]> {
    return this.#chain.getUtxos(this.#requireAddress(address));
  }

  /** Reject a foreign-network or malformed address before any lookup. */
  #requireAddress(address: string): string {
    const parsed = validateAddress(address, this.#config.network);
    if (!parsed.ok) {
      throw parsed.error;
    }
    return parsed.value.bech32;
  }
}

/** Native assets of a balance, sorted by unit, with lovelace excluded. */
export function tokensOf(assets: Assets): TokenBalance[] {
  const out: TokenBalance[] = [];
  for (const unit of Object.keys(assets).sort()) {
    if (unit === LOVELACE) {
      continue;
    }
    const parsed = fromUnit(unit);
    if (!parsed.ok) {
      // A balance read from the chain can in principle contain a unit core
      // will not parse. Skipping it is better than failing the whole call.
      continue;
    }
    out.push({
      unit,
      policyId: parsed.value.policyId,
      assetNameHex: parsed.value.assetNameHex,
      assetName: parsed.value.assetName,
      quantity: (assets[unit] ?? 0n).toString(),
    });
  }
  return out;
}
