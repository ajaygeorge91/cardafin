// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ajay George

export function discoverWallets(cardano) {
  return Object.values(cardano ?? {})
    .filter((wallet) => typeof wallet?.name === 'string' && wallet.name.trim()
      && typeof wallet.apiVersion === 'string' && typeof wallet.enable === 'function')
    .sort((a, b) => a.name.localeCompare(b.name));
}

const NETWORK_NAMES = { 0: 'Testnet', 1: 'Mainnet' };

/**
 * Connect and keep the CIP-30 api handle. `connectWallet` below is the
 * display-only version and stays as it was; anything that needs to sign
 * needs the handle, so it comes through here.
 */
export async function enableWallet(wallet) {
  try {
    const api = await wallet.enable();
    const networkId = await api.getNetworkId();
    return { name: wallet.name, networkId, network: NETWORK_NAMES[networkId] ?? 'Unknown network', api };
  } catch (error) {
    if (error?.code === -3) {
      throw new Error('Connection was declined. You can try again at any time.');
    }
    throw new Error('Could not connect. Unlock your wallet and try again.');
  }
}

export async function connectWallet(wallet) {
  const { name, network } = await enableWallet(wallet);
  return { name, network };
}
