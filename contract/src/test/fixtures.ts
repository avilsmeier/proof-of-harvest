/**
 * Fictional test data for Proof of Harvest.
 *
 * Every producer, organization, plot and amount below is invented. The figures
 * follow the demo narrative in docs/HANDOFF.md section 5: María, a fictional
 * coffee producer, requests S/2,400 of campaign support against an estimated
 * S/14,800 harvest settlement, under policy FIN-COFFEE-2027-v1.
 */

import {
  EvidenceStatus,
  pureCircuits,
  type CampaignCredential,
  type FinancingPolicy,
} from '../managed/ProofOfHarvest/contract/index.js';
import { issuerKeyPairFromSeed } from '../issuer.js';
import { AUTHORIZED_SUPPLIER_SLOTS } from '../witnesses.js';

/** UTF-8 encodes a label into a 32-byte identifier, zero-padded on the right. */
export const id32 = (label: string): Uint8Array => {
  const encoded = new TextEncoder().encode(label);
  if (encoded.length > 32) {
    throw new Error(`id32: "${label}" encodes to ${encoded.length} bytes, max 32`);
  }
  const out = new Uint8Array(32);
  out.set(encoded);
  return out;
};

/**
 * A deterministic 32-byte secret derived from a label.
 *
 * Test helper only. Real `producerSecretId` and `localSecretKey` values must come
 * from a CSPRNG: `producerSecretId` is the sole entropy binding a nullifier to a
 * producer, so a guessable value lets anyone link that producer's campaigns.
 */
export const secret32 = (label: string): Uint8Array => {
  const out = new Uint8Array(32);
  const encoded = new TextEncoder().encode(`poh:test-secret:${label}`);
  // Simple deterministic fill; adequate for tests, unacceptable in production.
  for (let i = 0; i < 32; i += 1) {
    out[i] = (encoded[i % encoded.length]! * 31 + i * 17 + 7) & 0xff;
  }
  return out;
};

// --- Participants -----------------------------------------------------------

/** The PoH registry admin (the network operator). */
export const ADMIN_SECRET = secret32('registry-admin');
export const OUTSIDER_SECRET = secret32('unauthorized-outsider');

/** Fictional exporter, the primary evidence issuer. */
export const EXPORTER_ID = id32('ISS-CHANCHAMAYO-EXPORT');
export const EXPORTER = issuerKeyPairFromSeed('chanchamayo-export');

/** A second registered issuer, used to prove settlement is issuer-bound. */
export const OTHER_ISSUER_ID = id32('ISS-SELVA-CERTIFIER');
export const OTHER_ISSUER = issuerKeyPairFromSeed('selva-certifier');

/** An issuer that exists but was never registered on-chain. */
export const UNREGISTERED_ISSUER_ID = id32('ISS-NOT-REGISTERED');
export const UNREGISTERED_ISSUER = issuerKeyPairFromSeed('not-registered');

/** The financier requesting eligibility, and a European buyer. */
export const FINANCIER_ID = id32('FIN-COOP-CREDIT-01');
export const BUYER_ID = id32('BUYER-EU-ROASTER-01');

// --- Suppliers --------------------------------------------------------------

export const AUTHORIZED_SUPPLIER = id32('SUP-AGROSELVA-SAC');
export const UNAUTHORIZED_SUPPLIER = id32('SUP-UNLISTED-VENDOR');

/** The policy's authorized supplier list, padded to the fixed slot count. */
export const AUTHORIZED_SUPPLIERS: Uint8Array[] = (() => {
  const named = [
    AUTHORIZED_SUPPLIER,
    id32('SUP-VIVERO-PICHANAKI'),
    id32('SUP-TRANSPORTE-SATIPO'),
  ];
  const list = [...named];
  while (list.length < AUTHORIZED_SUPPLIER_SLOTS) {
    list.push(new Uint8Array(32));
  }
  return list;
})();

// --- Policy -----------------------------------------------------------------

/** Unix seconds, treated as "now" throughout the tests. */
export const AS_OF_DATE = 1_800_000_000n;
const ONE_YEAR = 31_536_000n;

/**
 * FIN-COFFEE-2027-v1: at least 2 campaigns of history, and the requested
 * support must not exceed 20% of the estimated harvest settlement.
 */
export const POLICY: FinancingPolicy = {
  policyId: id32('FIN-COFFEE-2027'),
  version: 1n,
  minimumCampaigns: 2n,
  maxRatioNumerator: 20n,
  ratioDenominator: 100n,
  supplierSetHash: pureCircuits.supplierSetDigest(AUTHORIZED_SUPPLIERS),
};

// --- Credentials ------------------------------------------------------------

/** María's campaign, and the amount she is asking for. */
export const MARIA_CAMPAIGN_ID = id32('CAMPAIGN-COFFEE-2027-M01');
export const MARIA_SECRET_ID = secret32('maria-producer');
export const REQUESTED_VALUE = 2_400n;

/**
 * A credential that satisfies every condition of FIN-COFFEE-2027-v1.
 *
 * 2,400 * 100 <= 14,800 * 20  (240,000 <= 296,000), so the request sits just
 * inside the 20% ratio while the 14,800 estimate itself stays private.
 */
export const eligibleCredential = (
  overrides: Partial<CampaignCredential> = {},
): CampaignCredential => ({
  producerSecretId: MARIA_SECRET_ID,
  campaignId: MARIA_CAMPAIGN_ID,
  supplierId: AUTHORIZED_SUPPLIER,
  campaignCount: 3n,
  estimatedSettlementValue: 14_800n,
  certificationExpiry: AS_OF_DATE + ONE_YEAR,
  credentialExpiry: AS_OF_DATE + ONE_YEAR,
  plotOriginStatus: EvidenceStatus.pass,
  traceabilityStatus: EvidenceStatus.pass,
  activeCommitment: false,
  ...overrides,
});

/**
 * The three demo producers from HANDOFF section 10.1: one eligible, one over the
 * ratio limit, one already carrying an active commitment.
 */
export const DEMO_PRODUCERS = {
  eligible: eligibleCredential(),

  /** 2,400 * 100 > 9,000 * 20 (240,000 > 180,000) — over the 20% limit. */
  overRatioLimit: eligibleCredential({
    producerSecretId: secret32('jorge-producer'),
    campaignId: id32('CAMPAIGN-COFFEE-2027-J01'),
    estimatedSettlementValue: 9_000n,
  }),

  /** Already has campaign support outstanding. */
  activeCommitment: eligibleCredential({
    producerSecretId: secret32('rosa-producer'),
    campaignId: id32('CAMPAIGN-COFFEE-2027-R01'),
    activeCommitment: true,
  }),
} as const;
