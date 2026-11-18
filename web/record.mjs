// Fictional data with fixed reference hashes so the browser can check each version.
const listingId = '6wm18g2a5x';
const versions = [
  [1, 'Published', 'ForSale', 8500000, '2026-11-02T10:00:00Z', '16c076a661f528f92e3a3500e67c62eb935ba387ba0bb9a35047e18f4222262d'],
  [2, 'Price updated', 'ForSale', 8250000, '2026-11-06T10:00:00Z', 'f5dadea5ba66f2d848cbfc78209575fbe599ba4951e9a42eb019dd484ff71b1b'],
  [3, 'Marked sold', 'Sold', 8250000, '2026-11-10T10:00:00Z', 'c7832459e9e97c8a3c6dcec23e192f1b16d6fe2b0981dfd1d14972a6ddbaf2fa'],
];

export const samples = versions.map(([version, event, status, askAmount, at, hash]) => ({
  event,
  hash,
  payload: { listingId, version, status, askAmount, askCurrency: 'INR', at },
}));

export async function verifyRecord(payload, expectedHash) {
  // The demo payload is flat. Write sorted keys in the same order as core.
  const fields = Object.keys(payload).sort().map((key) =>
    `${JSON.stringify(key)}:${JSON.stringify(payload[key])}`);
  const bytes = new TextEncoder().encode(`{${fields.join(',')}}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return hash === expectedHash;
}
