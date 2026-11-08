// Everything that touches signing material. The only port whose
// implementation holds a secret, and therefore the one seam a KMS/HSM-backed
// signer slots into without touching services or core.
// See docs/ARCHITECTURE.md §4 and §6 ("Key custody v1").

import type { NativeScript } from "../core/native-script.ts";
import type { Network } from "../core/network.ts";

export type WalletInfo = {
  address: string;
  /** 28-byte payment key hash, 56 lowercase hex characters. */
  paymentKeyHash: string;
  accountIndex: number;
  network: Network;
};

export interface KeyPort {
  /** A fresh 24-word mnemonic. The caller stores it; cardafin never does. */
  generateMnemonic(): string;
  validateMnemonic(m: string): boolean;
  deriveWallet(
    mnemonic: string,
    accountIndex: number,
    network: Network,
  ): Promise<WalletInfo>;
  /**
   * blake2b-224 of the script's CBOR in the real adapter; a sha256-derived
   * 56-hex string in the fake. Core cannot compute it without a dependency,
   * which is why it lives on this port.
   */
  nativeScriptPolicyId(script: NativeScript): string;
}
