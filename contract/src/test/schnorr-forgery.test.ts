/**
 * Security regression test: the Schnorr challenge reduction must not be
 * prover-controlled.
 *
 * The upstream `modules/crypto/schnorr.compact` reference this project started
 * from asked a `getSchnorrReduction` witness for the quotient and remainder of
 * `challengeHash / 2^248` and asserted `q * 2^248 + r == challengeHash` with
 * `r : Uint<248>`. Because `q` was typed `Field` and the assertion is field
 * arithmetic mod p, a prover could solve `q = (challengeHash - r) * inv(2^248)`
 * for ANY in-range `r` — so the constraint proved `r` was in range but never
 * that it was the correct reduction.
 *
 * The consequence was universal forgery: one honest signature from a registered
 * issuer verifies against any message, by pinning `r` to the original challenge
 * and letting the chosen `q` absorb the new hash. No issuer secret needed.
 *
 * `src/schnorr.compact` now truncates the challenge deterministically in-circuit
 * via `degradeToTransient(upgradeFromTransient(c))`, with no witness input at
 * all. This test reproduces the original attack and asserts it fails.
 */

import { describe, expect, it } from 'vitest';
import { pureCircuits } from '../managed/ProofOfHarvest/contract/index.js';
import { signCredential } from '../issuer.js';
import { witnesses, type PoHPrivateState } from '../witnesses.js';
import { ProofOfHarvestSimulator } from './simulator.js';
import {
  ADMIN_SECRET,
  AS_OF_DATE,
  AUTHORIZED_SUPPLIERS,
  EXPORTER,
  EXPORTER_ID,
  FINANCIER_ID,
  POLICY,
  REQUESTED_VALUE,
  eligibleCredential,
  id32,
} from './fixtures.js';

/** BLS12-381 scalar field modulus — the field the reduction assert lived in. */
const FIELD_MODULUS =
  52435875175126190479447740508185965837690552500527637822603658699938581184513n;
const TWO_248 = 1n << 248n;

const modInverse = (a: bigint, m: bigint): bigint => {
  let [r0, r1] = [((a % m) + m) % m, m];
  let [s0, s1] = [1n, 0n];
  while (r1 !== 0n) {
    const q = r0 / r1;
    [r0, r1] = [r1, r0 - q * r1];
    [s0, s1] = [s1, s0 - q * s1];
  }
  return ((s0 % m) + m) % m;
};

const admin: PoHPrivateState = { localSecretKey: ADMIN_SECRET };

describe('Schnorr challenge reduction is not prover-controlled', () => {
  it('rejects replaying one honest signature onto a credential never signed', () => {
    const poh = new ProofOfHarvestSimulator(POLICY, admin);
    poh.as(admin).registerIssuer(EXPORTER_ID, EXPORTER.publicKey);
    const policyHash = poh.ledger().policyHash;

    // The only signature this issuer ever produced: an honest 9,000 capacity
    // estimate, which is too little to support a 2,400 request under the 20%
    // policy ratio.
    const honest = eligibleCredential({ estimatedSettlementValue: 9_000n });
    const signature = signCredential(EXPORTER, honest, policyHash);

    const challengeFor = (credential: typeof honest): bigint =>
      pureCircuits.schnorrChallenge3(
        signature.announcement.x,
        signature.announcement.y,
        EXPORTER.publicKey.x,
        EXPORTER.publicKey.y,
        pureCircuits.credentialMessage(credential, policyHash),
      );

    const producerHolding = (credential: typeof honest): PoHPrivateState => ({
      localSecretKey: id32('producer'),
      authorizedSuppliers: AUTHORIZED_SUPPLIERS,
      heldCredential: { credential, signature, issuerId: EXPORTER_ID },
    });

    // Baseline: the genuinely signed credential is correctly refused on ratio.
    expect(() => {
      poh
        .as(producerHolding(honest))
        .proveCampaignEligibility(FINANCIER_ID, REQUESTED_VALUE, AS_OF_DATE);
    }).toThrow('PoH: requested value exceeds the policy ratio of estimated settlement');

    // The attack: claim vastly more capacity, keep the honest signature, and
    // feed a quotient chosen so the old assertion would have accepted the
    // original challenge for the new message.
    const forged = eligibleCredential({
      estimatedSettlementValue: 999_999_999n,
      campaignCount: 99n,
    });
    const honestChallenge = challengeFor(honest) % TWO_248;
    const forgedChallenge = challengeFor(forged);
    const chosenQuotient =
      ((((forgedChallenge - honestChallenge) % FIELD_MODULUS) + FIELD_MODULUS) %
        FIELD_MODULUS) *
        modInverse(TWO_248, FIELD_MODULUS) %
      FIELD_MODULUS;

    // Sanity: the attack premise holds — the challenge really did change, and
    // the chosen quotient is outside anything an honest reduction produces.
    expect(forgedChallenge).not.toEqual(challengeFor(honest));
    expect(chosenQuotient).toBeGreaterThan(TWO_248);

    const attacker = new ProofOfHarvestSimulator(POLICY, admin);
    // Offer the malicious reduction. Under the fixed contract there is no such
    // witness to call, so this is inert; under the upstream contract it was a
    // universal forgery oracle.
    attacker.contract.witnesses = {
      ...witnesses,
      getSchnorrReduction: (
        ctx: { privateState: PoHPrivateState },
        challengeHash: bigint,
      ): [PoHPrivateState, [bigint, bigint]] => [
        ctx.privateState,
        challengeHash === forgedChallenge
          ? [chosenQuotient, honestChallenge]
          : [challengeHash / TWO_248, challengeHash % TWO_248],
      ],
    } as unknown as typeof attacker.contract.witnesses;
    attacker.as(admin).registerIssuer(EXPORTER_ID, EXPORTER.publicKey);

    expect(() => {
      attacker
        .as(producerHolding(forged))
        .proveCampaignEligibility(FINANCIER_ID, REQUESTED_VALUE, AS_OF_DATE);
    }).toThrow('PoH: invalid issuer signature');

    // And nothing was written to the shared ledger.
    expect(attacker.ledger().commitments.isEmpty()).toBe(true);
  });

  it('truncates the challenge to the low 248 bits deterministically', () => {
    // The off-chain signer applies `challenge % 2^248`; the circuit must agree
    // or no honest signature would verify. Cross-check the exposed primitive.
    for (const value of [
      0n,
      1n,
      TWO_248 - 1n,
      TWO_248,
      TWO_248 + 5n,
      FIELD_MODULUS - 1n,
    ]) {
      expect(pureCircuits.schnorrTruncateChallenge(value)).toEqual(value % TWO_248);
    }
  });

  it('accepts every honest signature it is given', () => {
    // Guards against a reduction that is sound but incomplete — a bounded
    // quotient, for instance, would reject a fraction of valid signatures.
    const poh = new ProofOfHarvestSimulator(POLICY, admin);
    poh.as(admin).registerIssuer(EXPORTER_ID, EXPORTER.publicKey);
    const policyHash = poh.ledger().policyHash;

    for (let i = 0; i < 24; i += 1) {
      const credential = eligibleCredential({
        campaignId: id32(`CAMPAIGN-SWEEP-${i}`),
        estimatedSettlementValue: 14_800n + BigInt(i),
      });
      expect(() => {
        poh
          .as({
            localSecretKey: id32('producer'),
            authorizedSuppliers: AUTHORIZED_SUPPLIERS,
            heldCredential: {
              credential,
              signature: signCredential(EXPORTER, credential, policyHash),
              issuerId: EXPORTER_ID,
            },
          })
          .proveCampaignEligibility(FINANCIER_ID, REQUESTED_VALUE, AS_OF_DATE);
      }, `honest signature ${i} must verify`).not.toThrow();
    }
  });
});
