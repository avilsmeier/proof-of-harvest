/**
 * Security regression test: a degenerate issuer signing key must be
 * unregisterable.
 *
 * `schnorrVerify` checks `response * G == announcement + c * pubKey`. If the
 * registered `pubKey` is the Jubjub identity, `c * pubKey` is the identity for
 * every challenge and the equation collapses to `response * G == announcement`,
 * which anyone satisfies by picking a nonce `k` and setting `response = k`. No
 * issuer secret is involved, so every credential attributed to that issuer
 * becomes forgeable by anybody.
 *
 * `ecMulGenerator(0)` produces exactly that point, so this is reachable by
 * accident — a zero-initialized key field or a key-generation bug — not only by
 * a malicious admin. `registerIssuer` now rejects it.
 */

import { describe, expect, it } from 'vitest';
import { pureCircuits } from '../managed/ProofOfHarvest/contract/index.js';
import type { PoHPrivateState } from '../witnesses.js';
import { ProofOfHarvestSimulator } from './simulator.js';
import { ADMIN_SECRET, EXPORTER, EXPORTER_ID, POLICY, id32 } from './fixtures.js';

const JUBJUB_L =
  6554484396890773809930967563523245729705921265872317281365359162392183254199n;
const FIELD_MODULUS =
  52435875175126190479447740508185965837690552500527637822603658699938581184513n;

const admin: PoHPrivateState = { localSecretKey: ADMIN_SECRET };
const BAD_ISSUER = id32('ISS-DEGENERATE');

describe('issuer signing key validation', () => {
  /**
   * Points the contract must refuse. The identity is the dangerous one; the
   * others are rejected by the runtime's own point decoding, and are included
   * so a future change that loosens decoding does not silently open a hole.
   */
  const rejected: [string, { x: bigint; y: bigint }][] = [
    ['the curve identity (0, 1)', { x: 0n, y: 1n }],
    ['ecMulGenerator(0), which is the identity', pureCircuits.deriveIssuerPublicKey(0n)],
    ['the struct default (0, 0)', { x: 0n, y: 0n }],
    ['an off-curve point (1, 1)', { x: 1n, y: 1n }],
    ['the order-2 point (0, -1)', { x: 0n, y: FIELD_MODULUS - 1n }],
  ];

  it.each(rejected)('refuses to register %s', (_label, pubKey) => {
    const poh = new ProofOfHarvestSimulator(POLICY, admin);
    expect(() => {
      poh.as(admin).registerIssuer(BAD_ISSUER, pubKey);
    }).toThrow();
    expect(poh.ledger().issuers.isEmpty()).toBe(true);
  });

  it('names the degenerate-key failure explicitly for the identity', () => {
    const poh = new ProofOfHarvestSimulator(POLICY, admin);
    expect(() => {
      poh.as(admin).registerIssuer(BAD_ISSUER, { x: 0n, y: 1n });
    }).toThrow('PoH: degenerate issuer public key');
  });

  it('refuses an empty issuer id', () => {
    const poh = new ProofOfHarvestSimulator(POLICY, admin);
    expect(() => {
      poh.as(admin).registerIssuer(new Uint8Array(32), EXPORTER.publicKey);
    }).toThrow('PoH: issuer id must not be empty');
  });

  it('still accepts legitimately generated keys', () => {
    const poh = new ProofOfHarvestSimulator(POLICY, admin);
    // Including the extremes of the scalar range, to confirm the prime-order
    // subgroup check is sound rather than merely restrictive.
    for (const [index, scalar] of [1n, 12345n, JUBJUB_L - 1n].entries()) {
      const pubKey = pureCircuits.deriveIssuerPublicKey(scalar);
      expect(() => {
        poh.as(admin).registerIssuer(id32(`ISS-OK-${index}`), pubKey);
      }).not.toThrow();
    }
    expect(poh.ledger().issuers.size()).toEqual(3n);

    const poh2 = new ProofOfHarvestSimulator(POLICY, admin);
    poh2.as(admin).registerIssuer(EXPORTER_ID, EXPORTER.publicKey);
    expect(poh2.issuer(EXPORTER_ID)?.active).toBe(true);
  });
});
