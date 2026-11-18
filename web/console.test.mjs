// The console, driven against a fake DOM and a fake server.
//
// This is the surface a reviewer looks at, so "it renders" should not be a
// thing anyone takes on faith. The fake DOM below is the minimum console.mjs
// actually touches — enough to prove that the module panels are built from
// the routes the server reported, that clicking a route shows what it
// answered, and that the login flow refuses in the two ways it must:
// no wallet, and a wallet on the wrong network.

import assert from 'node:assert/strict';
import test from 'node:test';

// --- the smallest DOM console.mjs can run against ----------------------

function makeDom() {
  const listeners = {};

  function element(tag = 'div') {
    const own = {};
    const el = {
      tagName: String(tag).toUpperCase(),
      children: [],
      dataset: {},
      textContent: '',
      className: '',
      parent: null,
      classList: {
        add: (name) => { own[name] = true },
        remove: (name) => { delete own[name] },
        contains: (name) => own[name] === true,
        toggle: (name, force) => { if (force) own[name] = true; else delete own[name] },
      },
      append(...nodes) {
        for (const node of nodes) {
          node.parent = el;
          el.children.push(node);
        }
      },
      replaceChildren(...nodes) {
        el.children = [];
        el.append(...nodes);
      },
      addEventListener(name, handler) { (el.handlers[name] ??= []).push(handler) },
      handlers: {},
      closest(selector) {
        for (let node = el; node; node = node.parent) {
          if (selector === 'section' && node.tagName === 'SECTION') return node;
          if (selector.startsWith('button') && node.tagName === 'BUTTON'
            && (node.dataset.get || node.dataset.post)) return node;
        }
        return null;
      },
      querySelector(selector) {
        const stack = [...el.children];
        while (stack.length > 0) {
          const node = stack.shift();
          if (node.tagName === selector.toUpperCase()) return node;
          stack.push(...node.children);
        }
        return null;
      },
      /** All descendants, so a test can look for a button by its label. */
      all() {
        const out = [];
        const stack = [...el.children];
        while (stack.length > 0) {
          const node = stack.shift();
          out.push(node);
          stack.push(...node.children);
        }
        return out;
      },
    };
    return el;
  }

  const bySelector = new Map();
  const document = {
    addEventListener(name, handler) { (listeners[name] ??= []).push(handler) },
    createElement: element,
    querySelector(selector) {
      if (!bySelector.has(selector)) {
        bySelector.set(selector, element(selector === 'main' ? 'main' : 'div'));
      }
      return bySelector.get(selector);
    },
    /** Dispatch a click the way a browser would: at the element, delegated. */
    click(el) {
      for (const handler of el.handlers.click ?? []) handler();
      for (const handler of listeners.click ?? []) handler({ target: el });
    },
  };

  return { document, element, get: (selector) => document.querySelector(selector) };
}

const CAPABILITIES = [
  {
    name: 'identity',
    description: 'CIP-8 verification.',
    state: 'scaffold',
    doneWhen: ['npm run check'],
    routes: [
      { method: 'POST', path: '/v1/identity/challenge' },
      { method: 'POST', path: '/v1/identity/preview' },
    ],
  },
];

const NOT_BUILT = {
  error: {
    code: 'NOT_IMPLEMENTED',
    message: 'identity: issuing a login challenge is not built yet',
    details: { readme: 'src/capabilities/identity/README.md' },
  },
};

/** Boot console.mjs against a fake document, window and fetch. */
async function boot(t, { cardano = {}, routes = {} } = {}) {
  const dom = makeDom();
  const asked = [];

  globalThis.document = dom.document;
  globalThis.window = { cardano };
  globalThis.fetch = async (path, options = {}) => {
    asked.push({ path, method: options.method ?? 'GET' });
    const answer = routes[path] ?? { status: 404, body: { error: { code: 'NOT_FOUND' } } };
    return {
      ok: answer.status < 400,
      status: answer.status,
      headers: { get: () => 'application/json' },
      async text() { return JSON.stringify(answer.body) },
    };
  };
  t.after(() => {
    delete globalThis.document;
    delete globalThis.window;
    delete globalThis.fetch;
  });

  // A fresh module instance per test: top-level code runs on import.
  await import(`./console.mjs?t=${Math.random()}`);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  return { dom, asked };
}

const BASE_ROUTES = {
  '/console/config': { status: 200, body: { network: 'Preview', apiKey: 'dev-console-not-a-real-key' } },
  '/console/capabilities': { status: 200, body: CAPABILITIES },
  '/v1/health': { status: 200, body: { ok: true, network: 'Preview' } },
};

test('each module panel is built from the routes the server reported', async (t) => {
  const { dom } = await boot(t, { routes: BASE_ROUTES });

  const main = dom.get('main');
  assert.equal(main.children.length, 1, 'one panel per capability');
  const labels = main.all().filter((n) => n.tagName === 'BUTTON').map((n) => n.textContent);
  assert.deepEqual(labels, ['POST /v1/identity/challenge', 'POST /v1/identity/preview']);

  assert.equal(dom.get('#network').textContent, 'Preview');
  assert.match(main.all().find((n) => n.tagName === 'PRE').textContent, /Done when:\n  \$ npm run check/);
});

test('clicking a route shows exactly what that route answered', async (t) => {
  const { dom, asked } = await boot(t, {
    routes: { ...BASE_ROUTES, '/v1/identity/challenge': { status: 501, body: NOT_BUILT } },
  });

  const button = dom.get('main').all()
    .find((n) => n.tagName === 'BUTTON' && n.dataset.post === '/v1/identity/challenge');
  dom.document.click(button);
  await new Promise((resolve) => setImmediate(resolve));

  const out = button.closest('section').querySelector('pre');
  assert.match(out.textContent, /^501/);
  assert.match(out.textContent, /NOT_IMPLEMENTED/);
  assert.ok(out.classList.contains('err'), 'a failed call is marked as one');
  assert.ok(asked.some((a) => a.path === '/v1/identity/challenge' && a.method === 'POST'));
});

test('with no wallet injected, the console points at the no-browser alternative', async (t) => {
  const { dom } = await boot(t, { routes: BASE_ROUTES });

  dom.document.click(dom.get('#detect'));
  await new Promise((resolve) => setImmediate(resolve));

  assert.match(dom.get('#login-out').textContent, /No CIP-30 wallet/);
  assert.match(dom.get('#login-out').textContent, /npm run console:probe/);
});

test('a wallet on the wrong network is refused before anything is signed', async (t) => {
  let signed = false;
  const lace = {
    name: 'Lace',
    apiVersion: '1.0.0',
    async enable() {
      return {
        async getNetworkId() { return 1 },          // Mainnet
        async getRewardAddresses() { return ['e0ff'] },
        async signData() { signed = true; return {} },
      };
    },
  };

  const { dom } = await boot(t, { cardano: { lace }, routes: BASE_ROUTES });

  dom.document.click(dom.get('#detect'));
  await new Promise((resolve) => setImmediate(resolve));
  dom.document.click(dom.get('#login-picker').children[0]);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(signed, false, 'nothing may be signed against the wrong network');
  assert.match(dom.get('#login-out').textContent, /console is on Preview and the wallet is on Mainnet/);
  assert.ok(dom.get('#login-out').classList.contains('err'));
});

test('the login flow reports each step, and stops at the unbuilt server half', async (t) => {
  const lace = {
    name: 'Lace',
    apiVersion: '1.0.0',
    async enable() {
      return {
        async getNetworkId() { return 0 },
        async getRewardAddresses() { return ['e0ff'] },
        async signData() { return { signature: '84', key: 'a4' } },
      };
    },
  };

  const { dom } = await boot(t, {
    cardano: { lace },
    routes: { ...BASE_ROUTES, '/v1/identity/challenge': { status: 501, body: NOT_BUILT } },
  });

  dom.document.click(dom.get('#detect'));
  await new Promise((resolve) => setImmediate(resolve));
  dom.document.click(dom.get('#login-picker').children[0]);
  await new Promise((resolve) => setImmediate(resolve));

  const text = dom.get('#login-out').textContent;
  assert.match(text, /connected to Lace on Testnet/);
  assert.match(text, /✗ request challenge — not built yet — see src\/capabilities\/identity\/README\.md/);
});
