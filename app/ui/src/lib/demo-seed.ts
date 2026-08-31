/**
 * Fictional demo data for Proof of Harvest, built with *live* timestamps.
 *
 * This mirrors the shape of contract/src/test/fixtures.ts (same three demo
 * producers HANDOFF.md section 10.1 asks for: one eligible, one rejected for
 * exceeding the ratio limit, one rejected for an active commitment) but does
 * NOT reuse that file's fixed `AS_OF_DATE` constant. That constant
 * (1_800_000_000n, ~January 2027) is fine for the in-process simulator the
 * contract tests run against, where "the current block time" is whatever the
 * test harness says it is. This app talks to the real Preprod chain, whose
 * clock is really today. `proveCampaignEligibility` and `proveEudrEvidence`
 * both assert `blockTimeGte(asOfDate)` — the supplied date must not be in the
 * future — so seeding credentials with a fixed date almost a year from now
 * would make every proof fail immediately with "as-of date must not be in
 * the future". Every date below is computed from `Date.now()` instead.
 */

import { AUTHORIZED_SUPPLIER_SLOTS, EvidenceStatus, issuerKeyPairFromSeed, pureCircuits, type CampaignCredential, type FinancingPolicy } from "proof-of-harvest-api";
import type { ProducerRecord } from "./demo-store";
import { bytesToHex, id32, randomBytes32 } from "./hex";

const ONE_YEAR_SECONDS = 31_536_000n;

/** Unix seconds, computed fresh — never cache this across a real proof call. */
export function nowSeconds(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}

export const AUTHORIZED_SUPPLIER = id32("SUP-AGROSELVA-SAC");
const NAMED_SUPPLIERS = [AUTHORIZED_SUPPLIER, id32("SUP-VIVERO-PICHANAKI"), id32("SUP-TRANSPORTE-SATIPO")];

/** The policy's authorized supplier list, padded to the fixed slot count. */
export function buildSupplierList(): Uint8Array[] {
  const list = [...NAMED_SUPPLIERS];
  while (list.length < AUTHORIZED_SUPPLIER_SLOTS) list.push(new Uint8Array(32));
  return list;
}

export const FINANCIER_ID = id32("FIN-COOP-CREDIT-01");
export const BUYER_ID = id32("BUYER-EU-ROASTER-01");

/** Generates a fresh, randomly-seeded issuer keypair for this browser session. */
export function generateIssuerKeyPair() {
  return issuerKeyPairFromSeed(bytesToHex(randomBytes32()));
}

export function buildPolicy(supplierList: Uint8Array[]): FinancingPolicy {
  return {
    policyId: id32("FIN-COFFEE-2027"),
    version: 1n,
    minimumCampaigns: 2n,
    maxRatioNumerator: 20n,
    ratioDenominator: 100n,
    supplierSetHash: pureCircuits.supplierSetDigest(supplierList),
  };
}

/**
 * The three demo producers from HANDOFF.md section 10.1 / 5.1–5.3: María
 * (eligible), Jorge (over the ratio limit), Rosa (active commitment already
 * attested). Every producer/campaign/parcel/amount here is invented.
 */
export function buildDemoProducers(supplierId: Uint8Array): Record<string, ProducerRecord> {
  const asOf = nowSeconds();
  const base = (overrides: Partial<CampaignCredential> = {}): CampaignCredential => ({
    producerSecretId: randomBytes32(),
    campaignId: randomBytes32(),
    supplierId,
    campaignCount: 3n,
    estimatedSettlementValue: 14_800n,
    certificationExpiry: asOf + ONE_YEAR_SECONDS,
    credentialExpiry: asOf + ONE_YEAR_SECONDS,
    plotOriginStatus: EvidenceStatus.pass,
    traceabilityStatus: EvidenceStatus.pass,
    activeCommitment: false,
    ...overrides,
  });

  return {
    maria: {
      label: "María",
      narrative:
        "3 campaigns of delivery history. Requesting S/2,400 against an estimated S/14,800 settlement — comfortably inside the 20% policy ratio.",
      requestedValue: 2_400n,
      credential: base(),
    },
    jorge: {
      label: "Jorge",
      narrative:
        "Requesting S/2,400, but his estimated settlement is only S/9,000 — the request exceeds the 20% ratio the policy allows.",
      requestedValue: 2_400n,
      credential: base({ campaignId: randomBytes32(), estimatedSettlementValue: 9_000n }),
    },
    rosa: {
      label: "Rosa",
      narrative:
        "Otherwise eligible, but the issuer's credential attests she already has an active campaign commitment outstanding.",
      requestedValue: 2_400n,
      credential: base({ campaignId: randomBytes32(), activeCommitment: true }),
    },
  };
}
