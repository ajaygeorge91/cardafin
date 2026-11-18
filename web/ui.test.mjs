import assert from 'node:assert/strict';
import test from 'node:test';

test('every sample version matches its recorded hash, and a changed price fails verification', async () => {
  const { samples, verifyRecord } = await import('./record.mjs');
  for (const sample of samples) {
    assert.equal(await verifyRecord(sample.payload, sample.hash), true);
    assert.equal(await verifyRecord({ ...sample.payload, askAmount: 1 }, sample.hash), false);
  }
});

test('the picker lists injected wallet providers and reports the connected network', async () => {
  const { discoverWallets, connectWallet } = await import('./wallet.mjs');
  const extension = {
    name: 'Lace',
    apiVersion: '1.0.0',
    async enable() { return { async getNetworkId() { return 0; } }; },
  };
  assert.deepEqual(discoverWallets({ unrelated: {}, lace: extension }).map(({ name }) => name), ['Lace']);
  assert.deepEqual(discoverWallets(undefined), []);
  assert.deepEqual(await connectWallet(extension), { name: 'Lace', network: 'Testnet' });
});

test('denied wallet access leaves the connection unresolved', async () => {
  const { connectWallet } = await import('./wallet.mjs');
  await assert.rejects(connectWallet({ name: 'Lace', async enable() { throw { code: -3 }; } }),
    /connection was declined/i);
});

test('opening the picker after a wallet disappears shows the current availability', async (t) => {
  // A minimal DOM and injected wallet exercise the browser module's event handlers.
  function element() {
    const handlers = {};
    return {
      children: [], dataset: {}, textContent: '', showModal() {},
      addEventListener(name, handler) { handlers[name] = handler; },
      click() { handlers.click(); },
      append(child) { this.children.push(child); },
      replaceChildren() { this.children = []; },
    };
  }
  const trigger = element();
  const elements = new Map();
  const document = {
    querySelectorAll: (selector) => selector === '[data-connect]' ? [trigger] : [],
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, element());
      return elements.get(selector);
    },
    createElement: element,
  };
  const extension = {
    name: 'Lace', apiVersion: '1.0.0',
    async enable() { return { async getNetworkId() { return 1; } }; },
  };
  globalThis.document = document;
  globalThis.window = { cardano: { lace: extension } };
  t.after(() => { delete globalThis.document; delete globalThis.window; });
  await import('./app.mjs');
  trigger.click();
  elements.get('#wallet-options').children[0].click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(elements.get('#wallet-feedback').textContent, /Lace connected.*Mainnet/);
  globalThis.window.cardano = {};
  trigger.click();
  assert.match(elements.get('#wallet-feedback').textContent, /No compatible wallet found/);
});
