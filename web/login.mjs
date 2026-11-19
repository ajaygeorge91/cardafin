// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ajay George

// The browser half of wallet login: CIP-30 in, a DataSignature out.
//
// The browser never builds the message it signs. `POST /v1/identity/challenge`
// returns both the challenge and the exact `message` string to sign, and this
// signs that verbatim. Otherwise the server has to recompose it
// byte-identically to verify — same field order, separators, line endings —
// and the first drift fails every signature with nothing to debug.
//
// CIP-30 does not hash the payload and uses no external_aad: the bytes go in
// as they are, hex-encoded. Do not add a hash step here.

/** utf-8 text -> lowercase hex, which is how CIP-30 wants its payload. */
export function toHexUtf8(text) {
  return Array.from(new TextEncoder().encode(text), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function fromHexUtf8(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return new TextDecoder().decode(bytes);
}

/** A 501 while `identity` is unwritten is a normal answer here, not a throw. */
export async function requestChallenge(call, { purpose = 'login' } = {}) {
  const res = await call('/v1/identity/challenge', {
    method: 'POST',
    body: JSON.stringify({ purpose }),
  });
  return res;
}

/**
 * Sign with the wallet's stake credential. `getRewardAddresses()` returns
 * hex, and signData wants that same hex, so nothing is decoded here.
 */
export async function signChallenge(api, challenge) {
  if (typeof challenge?.message !== 'string' || challenge.message === '') {
    throw new Error('the challenge carried no message to sign');
  }
  const rewardAddresses = await api.getRewardAddresses();
  const rewardAddress = rewardAddresses?.[0];
  if (!rewardAddress) {
    throw new Error('this wallet exposes no reward address, so it cannot sign a login');
  }

  const signed = await api.signData(rewardAddress, toHexUtf8(challenge.message));
  if (typeof signed?.signature !== 'string' || typeof signed?.key !== 'string') {
    throw new Error('the wallet returned something that is not a CIP-30 DataSignature');
  }
  return { rewardAddress, signature: signed.signature, key: signed.key };
}

/** Hand the signature back for verification. `nonce` ties it to the challenge. */
export async function verifySignature(call, { nonce, signature, key }) {
  return call('/v1/identity/verify', {
    method: 'POST',
    body: JSON.stringify({ nonce, signature: { signature, key } }),
  });
}

/**
 * The flow as a list of `{ step, ok, detail }`, failed step included, so the
 * console can show how far it got rather than only that it stopped.
 */
export async function runLogin({ call, api, onStep = () => {} }) {
  const steps = [];
  const record = (step, ok, detail) => {
    const entry = { step, ok, detail };
    steps.push(entry);
    onStep(entry);
    return entry;
  };

  const challengeRes = await requestChallenge(call);
  if (!challengeRes.ok) {
    record('request challenge', false, describe(challengeRes));
    return steps;
  }
  const challenge = challengeRes.body;
  record('request challenge', true, `nonce ${String(challenge.nonce).slice(0, 12)}…`);

  let signed;
  try {
    signed = await signChallenge(api, challenge);
  } catch (error) {
    record('sign with wallet', false, error.message);
    return steps;
  }
  record('sign with wallet', true, `${signed.rewardAddress.slice(0, 16)}…`);

  const verified = await verifySignature(call, { nonce: challenge.nonce, ...signed });
  record('verify on the server', verified.ok, describe(verified));
  return steps;
}

/**
 * Stop a wrong-network login before anything is signed. The server closes
 * cross-network replay properly, but "your wallet is on the wrong network"
 * is a better error than "invalid signature". CIP-30 network ids: 1 is
 * mainnet, anything else a testnet.
 */
export function networkMismatch(serverNetwork, networkId) {
  const walletMainnet = networkId === 1;
  const serverMainnet = serverNetwork === 'Mainnet';
  if (walletMainnet === serverMainnet) {
    return undefined;
  }
  return `This console is on ${serverNetwork} and the wallet is on `
    + `${walletMainnet ? 'Mainnet' : 'a testnet'}. Switch the wallet's network before signing.`;
}

/** Render an error, naming the brief when the route is simply unwritten. */
export function describe(result) {
  const error = result.body?.error;
  if (!error) {
    return `${result.status}`;
  }
  if (error.code === 'NOT_IMPLEMENTED') {
    return `not built yet — see ${error.details?.readme ?? 'the capability README'}`;
  }
  return `${error.code}: ${error.message}`;
}
