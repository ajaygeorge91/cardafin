// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ajay George

import { samples, verifyRecord } from './record.mjs';
import { connectWallet, discoverWallets } from './wallet.mjs';

const versionButtons = [...document.querySelectorAll('[data-version]')];
const price = document.querySelector('#record-price');
const hash = document.querySelector('#record-hash');
const status = document.querySelector('#record-status');
const version = document.querySelector('#version-number');
const verify = document.querySelector('#verify');
const result = document.querySelector('#verify-result');
const amountFormat = new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', maximumFractionDigits: 0,
});

let selection = samples.at(-1);

for (const button of versionButtons) {
  button.addEventListener('click', () => {
    selection = samples[Number(button.dataset.version)];
    for (const entry of versionButtons) entry.setAttribute('aria-pressed', String(entry === button));
    price.textContent = amountFormat.format(selection.payload.askAmount);
    version.textContent = selection.payload.version;
    hash.textContent = `${selection.hash.slice(0, 8)}…${selection.hash.slice(-8)}`;
    hash.title = selection.hash;
    const sold = selection.payload.status === 'Sold';
    status.textContent = sold ? 'Sold' : 'For sale';
    status.dataset.state = sold ? 'sold' : 'sale';
    result.textContent = '';
  });
}

verify.addEventListener('click', async () => {
  const current = selection;
  result.dataset.error = 'false';
  result.textContent = 'Computing the sample hash…';
  verify.disabled = true;
  try {
    const match = await verifyRecord(current.payload, current.hash);
    if (selection !== current) return;
    result.dataset.error = String(!match);
    result.textContent = match ? 'Hash matches the saved sample.' : 'Hash differs from the saved sample.';
  } catch {
    if (selection !== current) return;
    result.dataset.error = 'true';
    result.textContent = 'Open the preview on localhost or HTTPS to check the hash.';
  } finally {
    verify.disabled = false;
  }
});

const connectButtons = [...document.querySelectorAll('[data-connect]')];
const dialog = document.querySelector('#wallet-dialog');
const options = document.querySelector('#wallet-options');
const feedback = document.querySelector('#wallet-feedback');
const help = document.querySelector('#wallet-help');

let connecting = false;

function showWalletStatus(message, error = false) {
  feedback.dataset.error = String(error);
  feedback.textContent = message;
}

async function selectWallet(wallet) {
  connecting = true;
  for (const button of options.children) button.disabled = true;
  showWalletStatus('Check your wallet for the approval prompt.');
  try {
    const connection = await connectWallet(wallet);
    showWalletStatus(`${connection.name} connected · ${connection.network}`);
  } catch (error) {
    showWalletStatus(error.message, true);
  } finally {
    connecting = false;
    for (const button of options.children) button.disabled = false;
  }
}

for (const trigger of connectButtons) {
  trigger.addEventListener('click', () => {
    const wallets = discoverWallets(window.cardano);
    options.replaceChildren();
    help.hidden = wallets.length > 0;
    feedback.textContent = '';
    if (connecting) showWalletStatus('Check your wallet for the approval prompt.');
    else if (!wallets.length) showWalletStatus('No compatible wallet found.');
    for (const wallet of wallets) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'wallet-option';
      button.textContent = wallet.name;
      button.disabled = connecting;
      button.addEventListener('click', () => { void selectWallet(wallet); });
      options.append(button);
    }
    dialog.showModal();
  });
}
