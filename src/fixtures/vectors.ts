// Published specification test vectors — the values the specs themselves
// print, not made-up data. Nothing here is personal or secret.
//
// Provenance, so a reader can re-derive them:
//   * BLAKE2b — RFC 7693. The 512-bit digest of "abc" below is the reference
//     value printed in the RFC itself. The 224- and 160-bit digests were
//     produced by an independent implementation (Python's hashlib) and
//     cross-checked against it. Cardano uses blake2b-224 for key and script
//     hashes and blake2b-160 for asset fingerprints, and `node:crypto`
//     exposes neither.
//   * CIP-14 — the eight vectors in the CIP's own test-vector table.

export type Blake2bVector = {
  /** UTF-8 input. */
  readonly input: string;
  readonly digestBytes: 64 | 28 | 20;
  readonly hex: string;
};

export const BLAKE2B_VECTORS: readonly Blake2bVector[] = [
  // RFC 7693 Appendix A, verbatim.
  {
    input: "abc",
    digestBytes: 64,
    hex:
      "ba80a53f981c4d0d6a2797b69f12f6e94c212f14685ac4b74b12bb6fdbffa2d1" +
      "7d87c5392aab792dc252d5de4533cc9518d38aa8dbf1925ab92386edd4009923",
  },
  // blake2b-224: the digest size Cardano uses for key hashes and policy ids.
  { input: "abc", digestBytes: 28, hex: "9bd237b02a29e43bdd6738afa5b53ff0eee178d6210b618e4511aec8" },
  { input: "", digestBytes: 28, hex: "836cc68931c2e4e3e838602eca1902591d216837bafddfe6f0c8cb07" },
  // blake2b-160: the digest size CIP-14 hashes an asset down to.
  { input: "abc", digestBytes: 20, hex: "384264f676f39536840523f284921cdc68b6846b" },
];

export type Cip14Vector = {
  readonly policyId: string;
  /** Hex, possibly empty — an asset with no name is legal. */
  readonly assetNameHex: string;
  readonly fingerprint: string;
};

/** CIP-14's published table, in its published order. */
export const CIP14_VECTORS: readonly Cip14Vector[] = [
  {
    policyId: "7eae28af2208be856f7a119668ae52a49b73725e326dc16579dcc373",
    assetNameHex: "",
    fingerprint: "asset1rjklcrnsdzqp65wjgrg55sy9723kw09mlgvlc3",
  },
  {
    policyId: "7eae28af2208be856f7a119668ae52a49b73725e326dc16579dcc37e",
    assetNameHex: "",
    fingerprint: "asset1nl0puwxmhas8fawxp8nx4e2q3wekg969n2auw3",
  },
  {
    policyId: "1e349c9bdea19fd6c147626a5260bc44b71635f398b67c59881df209",
    assetNameHex: "",
    fingerprint: "asset1uyuxku60yqe57nusqzjx38aan3f2wq6s93f6ea",
  },
  {
    policyId: "7eae28af2208be856f7a119668ae52a49b73725e326dc16579dcc373",
    assetNameHex: "504154415445",
    fingerprint: "asset13n25uv0yaf5kus35fm2k86cqy60z58d9xmde92",
  },
  {
    policyId: "1e349c9bdea19fd6c147626a5260bc44b71635f398b67c59881df209",
    assetNameHex: "504154415445",
    fingerprint: "asset1hv4p5tv2a837mzqrst04d0dcptdjmluqvdx9k3",
  },
  {
    policyId: "1e349c9bdea19fd6c147626a5260bc44b71635f398b67c59881df209",
    assetNameHex: "7eae28af2208be856f7a119668ae52a49b73725e326dc16579dcc373",
    fingerprint: "asset1aqrdypg669jgazruv5ah07nuyqe0wxjhe2el6f",
  },
  {
    policyId: "7eae28af2208be856f7a119668ae52a49b73725e326dc16579dcc373",
    assetNameHex: "1e349c9bdea19fd6c147626a5260bc44b71635f398b67c59881df209",
    fingerprint: "asset17jd78wukhtrnmjh3fngzasxm8rck0l2r4hhyyt",
  },
  {
    policyId: "7eae28af2208be856f7a119668ae52a49b73725e326dc16579dcc373",
    assetNameHex: "0000000000000000000000000000000000000000000000000000000000000000",
    fingerprint: "asset1pkpwyknlvul7az0xx8czhl60pyel45rpje4z8w",
  },
];
