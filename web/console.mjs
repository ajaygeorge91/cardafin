// The console's whole client. No framework, no build step, no CDN — it is
// served by src/http/dev-server.ts from a clean clone with no node_modules.
//
// Two kinds of panel:
//   * Wallet and Login run against things that exist now — the fixture
//     ledger, and whatever CIP-30 wallet the browser has injected.
//   * One panel per capability, built from /console/capabilities, showing
//     the routes that capability actually registered. A route that answers
//     501 is drawn as "not built yet" with its README, because that is the
//     work, not a bug.

import { discoverWallets, enableWallet } from './wallet.mjs';
import { networkMismatch, runLogin } from './login.mjs';

const main = document.querySelector('main');
const walletOut = document.querySelector('#wallet-out');
const loginOut = document.querySelector('#login-out');
const loginPicker = document.querySelector('#login-picker');

let serverNetwork = 'unknown';

/** Everything goes through here so one failure mode renders one way. */
async function call(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...options,
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { ok: res.ok, status: res.status, body };
}

function render(target, result) {
  target.classList.toggle('err', !result.ok);
  const body = typeof result.body === 'string' ? result.body : JSON.stringify(result.body, null, 2);
  target.textContent = `${result.status}\n${body}`;
}

document.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-get], button[data-post]');
  if (!button) return;
  const out = button.closest('section').querySelector('pre');
  out.textContent = '…';
  const path = button.dataset.get ?? button.dataset.post;
  const options = button.dataset.post ? { method: 'POST', body: '{}' } : {};
  render(out, await call(path, options));
});

// --- the module panels -------------------------------------------------

function routeButton(route) {
  const button = document.createElement('button');
  if (route.method === 'POST') {
    button.dataset.post = route.path;
  } else {
    button.dataset.get = route.path;
  }
  button.textContent = `${route.method} ${route.path}`;
  return button;
}

function panel(capability) {
  const section = document.createElement('section');
  const state = capability.state === 'implemented' ? 'implemented' : 'scaffold';

  const heading = document.createElement('h2');
  heading.textContent = `${capability.name} `;
  const chip = document.createElement('span');
  chip.className = `state ${state}`;
  chip.textContent = state;
  heading.append(chip);

  const desc = document.createElement('p');
  desc.className = 'desc';
  desc.textContent = capability.description;

  const row = document.createElement('div');
  row.className = 'row';
  // The buttons are the capability's own registered routes, read back from
  // the server — not a list kept here that could drift from the code.
  row.append(...capability.routes.map(routeButton));

  // Read from a README on disk, so it goes in as text and never as markup.
  const out = document.createElement('pre');
  const commands = capability.doneWhen.map((c) => `  $ ${c}`).join('\n');
  out.textContent = `Done when:\n${commands || '  see the module README'}`;

  section.append(heading, desc, row, out);
  return section;
}

// --- wallet login ------------------------------------------------------

function step({ step: name, ok, detail }) {
  return `${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`;
}

async function login(wallet) {
  loginOut.classList.remove('err');
  loginOut.textContent = `Connecting to ${wallet.name}…`;

  let connected;
  try {
    connected = await enableWallet(wallet);
  } catch (error) {
    loginOut.classList.add('err');
    loginOut.textContent = error.message;
    return;
  }

  const mismatch = networkMismatch(serverNetwork, connected.networkId);
  if (mismatch) {
    loginOut.classList.add('err');
    loginOut.textContent = mismatch;
    return;
  }

  const lines = [`✓ connected to ${connected.name} on ${connected.network}`];
  loginOut.textContent = lines.join('\n');

  const steps = await runLogin({
    call,
    api: connected.api,
    onStep: (entry) => {
      lines.push(step(entry));
      loginOut.textContent = lines.join('\n');
    },
  });

  loginOut.classList.toggle('err', steps.some((s) => !s.ok));
}

function showWallets() {
  const wallets = discoverWallets(window.cardano);
  loginPicker.replaceChildren();

  if (wallets.length === 0) {
    loginOut.textContent =
      'No CIP-30 wallet is injected into this page.\n' +
      'Install Lace, Eternl, Nami or Flint, or run `npm run console:probe` for the same ' +
      'checks with no browser at all.';
    return;
  }

  for (const wallet of wallets) {
    const button = document.createElement('button');
    button.textContent = wallet.name;
    button.addEventListener('click', () => login(wallet));
    loginPicker.append(button);
  }
  loginOut.textContent = `${wallets.length} wallet(s) found. Pick one to sign in.`;
}

document.querySelector('#detect').addEventListener('click', showWallets);

// --- boot ---------------------------------------------------------------

async function boot() {
  const config = await call('/console/config');
  if (config.ok) {
    serverNetwork = config.body.network;
    document.querySelector('#network').textContent = serverNetwork;
  }

  const capabilities = await call('/console/capabilities');
  if (capabilities.ok) {
    for (const capability of capabilities.body) {
      main.append(panel(capability));
    }
  }

  render(walletOut, await call('/v1/health'));
}

boot();
