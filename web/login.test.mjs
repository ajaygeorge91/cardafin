// The login flow, with a fake wallet and a fake server.
//
// These run under `npm test` alongside the TypeScript suite, which is the
// point: the browser half of wallet login is the half nobody tests, and it
// is where the "signs bytes the server never issued" bug lives.

import assert from 'node:assert/strict';
import test from 'node:test';

const SIGNATURE = { signature: '84584da2012704', key: 'a4010103272006' };

function fakeWallet(overrides = {}) {
  return {
    async getRewardAddresses() { return ['e0f1f2f3f4f5f6f7f8f9'] },
    async signData(address, payloadHex) { return { ...SIGNATURE, address, payloadHex } },
    ...overrides,
  };
}

/** A `call` that answers from a table and records what it was asked. */
function fakeServer(responses) {
  const seen = [];
  const call = async (path, options = {}) => {
    seen.push({ path, body: options.body ? JSON.parse(options.body) : undefined });
    return responses[path] ?? { ok: false, status: 404, body: {} };
  };
  return { call, seen };
}

const CHALLENGE = {
  ok: true,
  status: 200,
  body: {
    nonce: 'a'.repeat(64),
    domain: 'cardafin.example.com',
    network: 'Preview',
    purpose: 'login',
    message: 'cardafin.example.com wants you to sign in.\nNonce: aaaa\nNetwork: Preview',
  },
};

test('utf-8 round-trips through the hex the wallet wants', async () => {
  const { toHexUtf8, fromHexUtf8 } = await import('./login.mjs');
  const message = 'cardafin.example.com wants you to sign in.\nNonce: 00ff';
  assert.equal(fromHexUtf8(toHexUtf8(message)), message);
  assert.equal(toHexUtf8('abc'), '616263');
});

test('the browser signs the server\'s message verbatim and never builds its own', async () => {
  const { signChallenge, toHexUtf8 } = await import('./login.mjs');
  const signed = await signChallenge(fakeWallet(), CHALLENGE.body);

  // The exact bytes handed to the wallet are the exact bytes the server
  // issued. If this ever stops holding, every signature fails verification.
  assert.equal(signed.payloadHex, undefined);
  const wallet = fakeWallet();
  let captured;
  wallet.signData = async (address, payloadHex) => { captured = { address, payloadHex }; return SIGNATURE };
  await signChallenge(wallet, CHALLENGE.body);
  assert.equal(captured.payloadHex, toHexUtf8(CHALLENGE.body.message));
  assert.equal(captured.address, 'e0f1f2f3f4f5f6f7f8f9', 'signs with the reward address, not a payment one');
});

test('a challenge with no message is refused before the wallet is bothered', async () => {
  const { signChallenge } = await import('./login.mjs');
  let called = false;
  const wallet = fakeWallet({ async signData() { called = true; return SIGNATURE } });
  await assert.rejects(signChallenge(wallet, { nonce: 'x' }), /no message to sign/);
  assert.equal(called, false);
});

test('a wallet with no reward address cannot log in, and says why', async () => {
  const { signChallenge } = await import('./login.mjs');
  const wallet = fakeWallet({ async getRewardAddresses() { return [] } });
  await assert.rejects(signChallenge(wallet, CHALLENGE.body), /no reward address/);
});

test('a wallet answering with something that is not a DataSignature is rejected', async () => {
  const { signChallenge } = await import('./login.mjs');
  const wallet = fakeWallet({ async signData() { return { signature: 'ok' } } });
  await assert.rejects(signChallenge(wallet, CHALLENGE.body), /not a CIP-30 DataSignature/);
});

test('the full flow reports each step, and stops at the first failure', async () => {
  const { runLogin } = await import('./login.mjs');
  const { call, seen } = fakeServer({
    '/v1/identity/challenge': CHALLENGE,
    '/v1/identity/verify': { ok: true, status: 200, body: { rewardAddress: 'stake_test1...' } },
  });

  const steps = await runLogin({ call, api: fakeWallet() });
  assert.deepEqual(steps.map((s) => [s.step, s.ok]), [
    ['request challenge', true],
    ['sign with wallet', true],
    ['verify on the server', true],
  ]);
  assert.equal(seen[1].body.nonce, CHALLENGE.body.nonce, 'the signature is tied to the nonce it answers');
});

test('an unbuilt identity capability reads as work, not as a crash', async () => {
  const { runLogin, describe } = await import('./login.mjs');
  const notBuilt = {
    ok: false,
    status: 501,
    body: {
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'identity: issuing a login challenge is not built yet',
        details: { readme: 'src/capabilities/identity/README.md' },
      },
    },
  };
  const { call } = fakeServer({ '/v1/identity/challenge': notBuilt });

  const steps = await runLogin({ call, api: fakeWallet() });
  assert.deepEqual(steps.map((s) => s.ok), [false]);
  assert.match(steps[0].detail, /not built yet — see src\/capabilities\/identity\/README\.md/);
  assert.match(describe(notBuilt), /README/);
});

test('a wallet on the wrong network is stopped before anything is signed', async () => {
  const { networkMismatch } = await import('./login.mjs');
  assert.equal(networkMismatch('Preview', 0), undefined);
  assert.equal(networkMismatch('Preprod', 0), undefined);
  assert.equal(networkMismatch('Mainnet', 1), undefined);
  assert.match(networkMismatch('Preview', 1), /console is on Preview and the wallet is on Mainnet/);
  assert.match(networkMismatch('Mainnet', 0), /wallet is on a testnet/);
});

test('the api handle survives connecting, and a declined connection says so plainly', async () => {
  const { enableWallet, connectWallet } = await import('./wallet.mjs');
  const extension = {
    name: 'Lace',
    apiVersion: '1.0.0',
    async enable() { return { async getNetworkId() { return 0 } } },
  };

  const connected = await enableWallet(extension);
  assert.equal(connected.network, 'Testnet');
  assert.equal(connected.networkId, 0);
  assert.equal(typeof connected.api.getNetworkId, 'function');

  // The display-only helper the picker uses is unchanged by any of this.
  assert.deepEqual(await connectWallet(extension), { name: 'Lace', network: 'Testnet' });
  await assert.rejects(
    enableWallet({ name: 'Lace', async enable() { throw { code: -3 } } }),
    /declined/i,
  );
});
