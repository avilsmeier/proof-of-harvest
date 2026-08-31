/**
 * Acceptance tests for the Proof of Harvest contract.
 *
 * The four MVP acceptance criteria from CLAUDE.md that this file is responsible
 * for are covered by the suites below:
 *   - a private quantitative threshold is verified   -> "campaign eligibility"
 *   - raw private values are not publicly disclosed  -> "privacy of the ledger"
 *   - the credential issuer is verifiable            -> "issuer authorization"
 *   - a commitment is registered, a duplicate fails  -> "duplicate financing"
 *   - a settlement can close the commitment          -> "settlement"
 *   - a second proof reuses the evidence for EUDR    -> "EUDR evidence reuse"
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  CommitmentStatus,
  EvidenceStatus,
  pureCircuits,
  type CampaignCredential,
} from '../managed/ProofOfHarvest/contract/index.js';
import { signCredential, signSettlement, type IssuerKeyPair } from '../issuer.js';
import type { PoHPrivateState } from '../witnesses.js';
import { ProofOfHarvestSimulator } from './simulator.js';
import {
  ADMIN_SECRET,
  AS_OF_DATE,
  AUTHORIZED_SUPPLIERS,
  BUYER_ID,
  DEMO_PRODUCERS,
  EXPORTER,
  EXPORTER_ID,
  FINANCIER_ID,
  MARIA_CAMPAIGN_ID,
  MARIA_SECRET_ID,
  OTHER_ISSUER,
  OTHER_ISSUER_ID,
  OUTSIDER_SECRET,
  POLICY,
  REQUESTED_VALUE,
  UNAUTHORIZED_SUPPLIER,
  UNREGISTERED_ISSUER,
  UNREGISTERED_ISSUER_ID,
  eligibleCredential,
  id32,
  secret32,
} from './fixtures.js';

const adminState: PoHPrivateState = { localSecretKey: ADMIN_SECRET };
const outsiderState: PoHPrivateState = { localSecretKey: OUTSIDER_SECRET };

let poh: ProofOfHarvestSimulator;

/** Builds the private state of a producer holding an issuer-signed credential. */
const producerHolding = (
  credential: CampaignCredential,
  options: { issuer?: IssuerKeyPair; issuerId?: Uint8Array } = {},
): PoHPrivateState => {
  const issuer = options.issuer ?? EXPORTER;
  return {
    localSecretKey: secret32('producer-local'),
    heldCredential: {
      credential,
      signature: signCredential(issuer, credential, poh.ledger().policyHash),
      issuerId: options.issuerId ?? EXPORTER_ID,
    },
    authorizedSuppliers: AUTHORIZED_SUPPLIERS,
  };
};

/** Builds the private state of an issuer authorizing settlement of a campaign. */
const issuerSettling = (
  nullifier: Uint8Array,
  options: { issuer?: IssuerKeyPair; issuerId?: Uint8Array } = {},
): PoHPrivateState => {
  const issuer = options.issuer ?? EXPORTER;
  return {
    localSecretKey: secret32('exporter-local'),
    settlementAttestation: {
      signature: signSettlement(issuer, nullifier, poh.ledger().policyHash),
      issuerId: options.issuerId ?? EXPORTER_ID,
    },
  };
};

/** Deploys, then registers the two issuers the tests rely on. */
beforeEach(() => {
  poh = new ProofOfHarvestSimulator(POLICY, adminState);
  poh.as(adminState).registerIssuer(EXPORTER_ID, EXPORTER.publicKey);
  poh.as(adminState).registerIssuer(OTHER_ISSUER_ID, OTHER_ISSUER.publicKey);
});

/** Runs the happy-path eligibility proof and returns the reserved nullifier. */
const proveMariaEligible = (): Uint8Array =>
  poh
    .as(producerHolding(DEMO_PRODUCERS.eligible))
    .proveCampaignEligibility(FINANCIER_ID, REQUESTED_VALUE, AS_OF_DATE);

describe('deployment', () => {
  it('seals the policy and its hash into public state', () => {
    const { policy, policyHash } = poh.ledger();
    expect(policy.policyId).toEqual(POLICY.policyId);
    expect(policy.version).toEqual(1n);
    expect(policy.minimumCampaigns).toEqual(2n);
    expect(policy.maxRatioNumerator).toEqual(20n);
    expect(policy.ratioDenominator).toEqual(100n);
    expect(policyHash).toHaveLength(32);
  });

  it('pins the deployer as registry admin via a derived identity, not their key', () => {
    const { admin } = poh.ledger();
    expect(admin).toEqual(pureCircuits.deriveAdminId(ADMIN_SECRET));
    // The raw secret must never be recoverable from public state.
    expect(admin).not.toEqual(ADMIN_SECRET);
  });

  it('starts with no commitments and no EUDR attestations', () => {
    expect(poh.ledger().commitments.isEmpty()).toBe(true);
    expect(poh.ledger().eudrAttestations.isEmpty()).toBe(true);
  });
});

describe('issuer registry', () => {
  it('records a registered issuer as active with its signing key', () => {
    const record = poh.issuer(EXPORTER_ID);
    expect(record?.active).toBe(true);
    expect(record?.pubKey).toEqual(EXPORTER.publicKey);
  });

  it('rejects registration by anyone other than the registry admin', () => {
    expect(() => {
      poh.as(outsiderState).registerIssuer(id32('ISS-ROGUE'), UNREGISTERED_ISSUER.publicKey);
    }).toThrow('PoH: caller is not the registry admin');
  });

  it('rejects revocation by anyone other than the registry admin', () => {
    expect(() => {
      poh.as(outsiderState).revokeIssuer(EXPORTER_ID);
    }).toThrow('PoH: caller is not the registry admin');
  });

  it('marks a revoked issuer inactive while keeping its key on record', () => {
    poh.as(adminState).revokeIssuer(EXPORTER_ID);
    const record = poh.issuer(EXPORTER_ID);
    expect(record?.active).toBe(false);
    expect(record?.pubKey).toEqual(EXPORTER.publicKey);
  });

  it('rejects revoking an issuer that was never registered', () => {
    expect(() => {
      poh.as(adminState).revokeIssuer(UNREGISTERED_ISSUER_ID);
    }).toThrow('PoH: issuer is not registered');
  });
});

describe('issuer authorization', () => {
  it('accepts a credential signed by a registered, active issuer', () => {
    expect(() => proveMariaEligible()).not.toThrow();
  });

  it('rejects a credential attributed to an unregistered issuer', () => {
    expect(() => {
      poh
        .as(
          producerHolding(DEMO_PRODUCERS.eligible, {
            issuer: UNREGISTERED_ISSUER,
            issuerId: UNREGISTERED_ISSUER_ID,
          }),
        )
        .proveCampaignEligibility(FINANCIER_ID, REQUESTED_VALUE, AS_OF_DATE);
    }).toThrow('PoH: issuer is not registered');
  });

  it('rejects a credential signed by a revoked issuer', () => {
    const producer = producerHolding(DEMO_PRODUCERS.eligible);
    poh.as(adminState).revokeIssuer(EXPORTER_ID);
    expect(() => {
      poh.as(producer).proveCampaignEligibility(FINANCIER_ID, REQUESTED_VALUE, AS_OF_DATE);
    }).toThrow('PoH: issuer has been revoked');
  });

  it('rejects a credential signed by a different registered issuer than claimed', () => {
    // OTHER_ISSUER is registered and active, but the credential claims EXPORTER_ID,
    // so verification runs against EXPORTER's key and the signature does not close.
    expect(() => {
      poh
        .as(producerHolding(DEMO_PRODUCERS.eligible, { issuer: OTHER_ISSUER }))
        .proveCampaignEligibility(FINANCIER_ID, REQUESTED_VALUE, AS_OF_DATE);
    }).toThrow('PoH: invalid issuer signature');
  });

  it('rejects a credential whose values were edited after signing', () => {
    // The producer keeps the issuer's real signature but inflates their capacity
    // so an over-limit request would pass. This is the core forgery attempt.
    const honest = DEMO_PRODUCERS.overRatioLimit;
    const signed = producerHolding(honest);
    const tampered: PoHPrivateState = {
      ...signed,
      heldCredential: {
        ...signed.heldCredential!,
        credential: { ...honest, estimatedSettlementValue: 1_000_000n },
      },
    };
    expect(() => {
      poh.as(tampered).proveCampaignEligibility(FINANCIER_ID, REQUESTED_VALUE, AS_OF_DATE);
    }).toThrow('PoH: invalid issuer signature');
  });

  it('rejects a credential signed against a different policy hash', () => {
    const credential = DEMO_PRODUCERS.eligible;
    const wrongPolicyHash = new Uint8Array(32).fill(9);
    const producer: PoHPrivateState = {
      localSecretKey: secret32('producer-local'),
      heldCredential: {
        credential,
        signature: signCredential(EXPORTER, credential, wrongPolicyHash),
        issuerId: EXPORTER_ID,
      },
      authorizedSuppliers: AUTHORIZED_SUPPLIERS,
    };
    expect(() => {
      poh.as(producer).proveCampaignEligibility(FINANCIER_ID, REQUESTED_VALUE, AS_OF_DATE);
    }).toThrow('PoH: invalid issuer signature');
  });
});

describe('campaign eligibility', () => {
  it('reserves a commitment when every policy condition is satisfied', () => {
    const nullifier = proveMariaEligible();

    expect(nullifier).toEqual(
      pureCircuits.campaignNullifier(POLICY.policyId, MARIA_SECRET_ID, MARIA_CAMPAIGN_ID),
    );

    const commitment = poh.commitment(nullifier);
    expect(commitment?.status).toEqual(CommitmentStatus.reserved);
    expect(commitment?.policyVersion).toEqual(POLICY.version);
    expect(commitment?.requesterId).toEqual(FINANCIER_ID);
    expect(commitment?.issuerId).toEqual(EXPORTER_ID);
    expect(commitment?.requestedValue).toEqual(REQUESTED_VALUE);
    expect(poh.ledger().commitments.size()).toEqual(1n);
  });

  // The private quantitative comparison the MVP hinges on. The estimate stays
  // private in every one of these cases; only pass/fail is observable.
  describe('the private capacity ratio', () => {
    const requestFor = (estimate: bigint, requested: bigint = REQUESTED_VALUE) =>
      poh
        .as(producerHolding(eligibleCredential({ estimatedSettlementValue: estimate })))
        .proveCampaignEligibility(FINANCIER_ID, requested, AS_OF_DATE);

    it('rejects a request that exceeds 20% of the private estimated settlement', () => {
      // 2,400 * 100 > 9,000 * 20  ->  240,000 > 180,000
      expect(() => requestFor(9_000n)).toThrow(
        'PoH: requested value exceeds the policy ratio of estimated settlement',
      );
    });

    it('accepts a request exactly at the ratio boundary', () => {
      // 2,400 * 100 == 12,000 * 20  ->  240,000 == 240,000
      expect(() => requestFor(12_000n)).not.toThrow();
    });

    it('rejects a request one unit past the ratio boundary', () => {
      // 2,401 * 100 > 12,000 * 20  ->  240,100 > 240,000
      expect(() => requestFor(12_000n, REQUESTED_VALUE + 1n)).toThrow(
        'PoH: requested value exceeds the policy ratio of estimated settlement',
      );
    });

    it('rejects a zero request', () => {
      expect(() => requestFor(14_800n, 0n)).toThrow(
        'PoH: requested value must be positive',
      );
    });
  });

  describe('the remaining policy conditions', () => {
    const proveWith = (overrides: Partial<CampaignCredential>) =>
      poh
        .as(producerHolding(eligibleCredential(overrides)))
        .proveCampaignEligibility(FINANCIER_ID, REQUESTED_VALUE, AS_OF_DATE);

    it('rejects insufficient campaign history', () => {
      expect(() => proveWith({ campaignCount: 1n })).toThrow(
        'PoH: insufficient campaign history',
      );
    });

    it('accepts campaign history exactly at the minimum', () => {
      expect(() => proveWith({ campaignCount: 2n })).not.toThrow();
    });

    it('rejects an expired certification', () => {
      expect(() => proveWith({ certificationExpiry: AS_OF_DATE - 1n })).toThrow(
        'PoH: certification is not current',
      );
    });

    it('rejects an expired credential', () => {
      expect(() => proveWith({ credentialExpiry: AS_OF_DATE - 1n })).toThrow(
        'PoH: credential has expired',
      );
    });

    it('rejects a plot whose origin policy did not pass', () => {
      expect(() => proveWith({ plotOriginStatus: EvidenceStatus.fail })).toThrow(
        'PoH: plot origin policy not satisfied',
      );
    });

    it('rejects a plot whose origin status was never assessed', () => {
      // `unknown` is the zero value, so this also guards against a
      // default-initialized credential passing the origin check.
      expect(() => proveWith({ plotOriginStatus: EvidenceStatus.unknown })).toThrow(
        'PoH: plot origin policy not satisfied',
      );
    });

    it('rejects a producer who already carries an active commitment', () => {
      expect(() => proveWith({ activeCommitment: true })).toThrow(
        'PoH: issuer attested an active campaign commitment for this producer',
      );
    });

    it('rejects an unauthorized supplier without disclosing the supplier', () => {
      expect(() => proveWith({ supplierId: UNAUTHORIZED_SUPPLIER })).toThrow(
        'PoH: supplier is not authorized',
      );
    });

    it('rejects an all-zero supplier rather than matching the list padding', () => {
      // The policy has 3 named suppliers in 8 slots, so slots 4-8 are all-zero.
      // A default-initialized or buggy credential emits an all-zero supplierId,
      // which must not match that padding.
      expect(() => proveWith({ supplierId: new Uint8Array(32) })).toThrow(
        'PoH: supplier is not authorized',
      );
    });

    it('rejects a supplier list that does not match the policy digest', () => {
      // A producer swapping in their own list to smuggle an unlisted supplier
      // through must fail against the on-chain digest.
      const smuggled = [UNAUTHORIZED_SUPPLIER, ...AUTHORIZED_SUPPLIERS.slice(1)];
      const producer = producerHolding(
        eligibleCredential({ supplierId: UNAUTHORIZED_SUPPLIER }),
      );
      expect(() => {
        poh
          .as({ ...producer, authorizedSuppliers: smuggled })
          .proveCampaignEligibility(FINANCIER_ID, REQUESTED_VALUE, AS_OF_DATE);
      }).toThrow("PoH: supplier list does not match the policy's authorized supplier set");
    });

    it('rejects an as-of date in the future', () => {
      expect(() => {
        poh
          .as(producerHolding(DEMO_PRODUCERS.eligible))
          .proveCampaignEligibility(FINANCIER_ID, REQUESTED_VALUE, AS_OF_DATE + 86_400n);
      }).toThrow('PoH: as-of date must not be in the future');
    });
  });

  it('leaves no commitment behind when a proof is rejected', () => {
    expect(() => {
      poh
        .as(producerHolding(DEMO_PRODUCERS.overRatioLimit))
        .proveCampaignEligibility(FINANCIER_ID, REQUESTED_VALUE, AS_OF_DATE);
    }).toThrow();
    expect(poh.ledger().commitments.isEmpty()).toBe(true);
  });

  it('walks the three demo producers to their expected outcomes', () => {
    expect(() => proveMariaEligible()).not.toThrow();

    expect(() => {
      poh
        .as(producerHolding(DEMO_PRODUCERS.overRatioLimit))
        .proveCampaignEligibility(FINANCIER_ID, REQUESTED_VALUE, AS_OF_DATE);
    }).toThrow('PoH: requested value exceeds the policy ratio of estimated settlement');

    expect(() => {
      poh
        .as(producerHolding(DEMO_PRODUCERS.activeCommitment))
        .proveCampaignEligibility(FINANCIER_ID, REQUESTED_VALUE, AS_OF_DATE);
    }).toThrow('PoH: issuer attested an active campaign commitment for this producer');

    // Only the eligible producer left a commitment on-chain.
    expect(poh.ledger().commitments.size()).toEqual(1n);
  });
});

describe('duplicate financing', () => {
  it('rejects a second request against the same campaign', () => {
    proveMariaEligible();
    expect(() => proveMariaEligible()).toThrow(
      'PoH: this campaign already has a registered commitment',
    );
    expect(poh.ledger().commitments.size()).toEqual(1n);
  });

  it('rejects a duplicate even when a different financier asks', () => {
    // This is the cross-institution guarantee: the nullifier is derived from the
    // producer and the campaign, not from who is asking.
    proveMariaEligible();
    expect(() => {
      poh
        .as(producerHolding(DEMO_PRODUCERS.eligible))
        .proveCampaignEligibility(id32('FIN-RIVAL-BANK-02'), REQUESTED_VALUE, AS_OF_DATE);
    }).toThrow('PoH: this campaign already has a registered commitment');
  });

  it('rejects a duplicate even when a different registered issuer attests it', () => {
    proveMariaEligible();
    expect(() => {
      poh
        .as(
          producerHolding(DEMO_PRODUCERS.eligible, {
            issuer: OTHER_ISSUER,
            issuerId: OTHER_ISSUER_ID,
          }),
        )
        .proveCampaignEligibility(FINANCIER_ID, REQUESTED_VALUE, AS_OF_DATE);
    }).toThrow('PoH: this campaign already has a registered commitment');
  });

  it('allows the same producer to finance a genuinely different campaign', () => {
    proveMariaEligible();
    poh
      .as(
        producerHolding(
          eligibleCredential({ campaignId: id32('CAMPAIGN-COFFEE-2028-M01') }),
        ),
      )
      .proveCampaignEligibility(FINANCIER_ID, REQUESTED_VALUE, AS_OF_DATE);
    expect(poh.ledger().commitments.size()).toEqual(2n);
  });
});

describe('settlement', () => {
  let nullifier: Uint8Array;

  beforeEach(() => {
    nullifier = proveMariaEligible();
  });

  it('closes an open commitment when the issuing organization authorizes it', () => {
    poh.as(issuerSettling(nullifier)).settleCampaign(nullifier);
    const commitment = poh.commitment(nullifier);
    expect(commitment?.status).toEqual(CommitmentStatus.settled);
    // Settling must not disturb the rest of the record.
    expect(commitment?.requestedValue).toEqual(REQUESTED_VALUE);
    expect(commitment?.issuerId).toEqual(EXPORTER_ID);
  });

  it('rejects settlement authorized by a different registered issuer', () => {
    expect(() => {
      poh
        .as(issuerSettling(nullifier, { issuer: OTHER_ISSUER, issuerId: OTHER_ISSUER_ID }))
        .settleCampaign(nullifier);
    }).toThrow('PoH: settlement must be attested by the issuing organization');
  });

  it('rejects settlement whose signature does not match the claimed issuer', () => {
    // Claims to be the exporter, but the signature is the other issuer's.
    expect(() => {
      poh.as(issuerSettling(nullifier, { issuer: OTHER_ISSUER })).settleCampaign(nullifier);
    }).toThrow('PoH: invalid issuer signature');
  });

  it('rejects a settlement signature issued for a different campaign', () => {
    const otherNullifier = pureCircuits.campaignNullifier(
      POLICY.policyId,
      secret32('someone-else'),
      id32('CAMPAIGN-OTHER'),
    );
    expect(() => {
      poh.as(issuerSettling(otherNullifier)).settleCampaign(nullifier);
    }).toThrow('PoH: invalid issuer signature');
  });

  it('rejects settling a campaign that was never registered', () => {
    const unknown = pureCircuits.campaignNullifier(
      POLICY.policyId,
      secret32('never-proved'),
      id32('CAMPAIGN-NONE'),
    );
    expect(() => {
      poh.as(issuerSettling(unknown)).settleCampaign(unknown);
    }).toThrow('PoH: no registered commitment for this campaign');
  });

  it('rejects settling the same commitment twice', () => {
    poh.as(issuerSettling(nullifier)).settleCampaign(nullifier);
    expect(() => {
      poh.as(issuerSettling(nullifier)).settleCampaign(nullifier);
    }).toThrow('PoH: commitment is not open for settlement');
  });

  it('keeps a settled campaign closed to new financing', () => {
    // Settlement closes the account; it does not release the campaign for a
    // second round of financing within the same program.
    poh.as(issuerSettling(nullifier)).settleCampaign(nullifier);
    expect(() => proveMariaEligible()).toThrow(
      'PoH: this campaign already has a registered commitment',
    );
  });
});

describe('EUDR evidence reuse', () => {
  it('answers a buyer using the same credential, under a separate reference', () => {
    const reference = poh
      .as(producerHolding(DEMO_PRODUCERS.eligible))
      .proveEudrEvidence(BUYER_ID, AS_OF_DATE);

    expect(reference).toEqual(
      pureCircuits.eudrEvidenceRef(
        POLICY.policyId,
        MARIA_SECRET_ID,
        MARIA_CAMPAIGN_ID,
        BUYER_ID,
      ),
    );

    const attestation = poh.eudrAttestation(reference);
    expect(attestation?.buyerId).toEqual(BUYER_ID);
    expect(attestation?.issuerId).toEqual(EXPORTER_ID);
    expect(attestation?.policyVersion).toEqual(POLICY.version);
  });

  it('keeps the EUDR reference unlinkable to the campaign nullifier', () => {
    const nullifier = proveMariaEligible();
    const reference = poh
      .as(producerHolding(DEMO_PRODUCERS.eligible))
      .proveEudrEvidence(BUYER_ID, AS_OF_DATE);
    // Same producer and campaign, different domain separator: an observer
    // holding one cannot derive the other.
    expect(reference).not.toEqual(nullifier);
  });

  it('requires traceability evidence, which the finance policy does not check', () => {
    const credential = eligibleCredential({
      traceabilityStatus: EvidenceStatus.unknown,
    });
    // The same credential is still fine for financing...
    expect(() => {
      poh
        .as(producerHolding(credential))
        .proveCampaignEligibility(FINANCIER_ID, REQUESTED_VALUE, AS_OF_DATE);
    }).not.toThrow();
    // ...but not for the buyer's origin and traceability question.
    expect(() => {
      poh.as(producerHolding(credential)).proveEudrEvidence(BUYER_ID, AS_OF_DATE);
    }).toThrow('PoH: traceability evidence is incomplete');
  });

  it('serves a producer who is not eligible for financing', () => {
    // Market access and campaign finance are independent policies over one
    // credential: failing the capacity ratio must not block EUDR reporting.
    const producer = producerHolding(DEMO_PRODUCERS.overRatioLimit);
    expect(() => {
      poh.as(producer).proveCampaignEligibility(FINANCIER_ID, REQUESTED_VALUE, AS_OF_DATE);
    }).toThrow('PoH: requested value exceeds the policy ratio of estimated settlement');
    expect(() => {
      poh.as(producer).proveEudrEvidence(BUYER_ID, AS_OF_DATE);
    }).not.toThrow();
  });

  it('keeps each buyer’s attestation separate instead of overwriting', () => {
    const secondBuyer = id32('BUYER-EU-ROASTER-02');
    const first = poh
      .as(producerHolding(DEMO_PRODUCERS.eligible))
      .proveEudrEvidence(BUYER_ID, AS_OF_DATE);
    const second = poh
      .as(producerHolding(DEMO_PRODUCERS.eligible))
      .proveEudrEvidence(secondBuyer, AS_OF_DATE);

    expect(second).not.toEqual(first);
    expect(poh.ledger().eudrAttestations.size()).toEqual(2n);
    expect(poh.eudrAttestation(first)?.buyerId).toEqual(BUYER_ID);
    expect(poh.eudrAttestation(second)?.buyerId).toEqual(secondBuyer);
  });

  it('is idempotent for a repeat request from the same buyer', () => {
    const first = poh
      .as(producerHolding(DEMO_PRODUCERS.eligible))
      .proveEudrEvidence(BUYER_ID, AS_OF_DATE);
    const repeat = poh
      .as(producerHolding(DEMO_PRODUCERS.eligible))
      .proveEudrEvidence(BUYER_ID, AS_OF_DATE);
    expect(repeat).toEqual(first);
    expect(poh.ledger().eudrAttestations.size()).toEqual(1n);
  });

  it('still requires a registered, active issuer', () => {
    const producer = producerHolding(DEMO_PRODUCERS.eligible);
    poh.as(adminState).revokeIssuer(EXPORTER_ID);
    expect(() => {
      poh.as(producer).proveEudrEvidence(BUYER_ID, AS_OF_DATE);
    }).toThrow('PoH: issuer has been revoked');
  });
});

describe('privacy of the ledger', () => {
  /** Collects every scalar and byte string reachable in public ledger state. */
  const publicLedgerValues = (): { numbers: Set<bigint>; blobs: string[] } => {
    const numbers = new Set<bigint>();
    const blobs: string[] = [];
    const toHex = (bytes: Uint8Array) =>
      [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

    const walk = (value: unknown): void => {
      if (typeof value === 'bigint') {
        numbers.add(value);
      } else if (value instanceof Uint8Array) {
        blobs.push(toHex(value));
      } else if (Array.isArray(value)) {
        value.forEach(walk);
      } else if (value !== null && typeof value === 'object') {
        Object.values(value as Record<string, unknown>).forEach(walk);
      }
    };

    const state = poh.ledger();
    walk(state.admin);
    walk(state.policy);
    walk(state.policyHash);
    for (const [key, record] of state.issuers) {
      walk(key);
      walk(record);
    }
    for (const [key, record] of state.commitments) {
      walk(key);
      walk(record);
    }
    for (const [key, record] of state.eudrAttestations) {
      walk(key);
      walk(record);
    }
    return { numbers, blobs };
  };

  const toHex = (bytes: Uint8Array) =>
    [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

  beforeEach(() => {
    // Exercise every circuit that touches a private credential, so the scan
    // covers all the state those circuits can write.
    const nullifier = proveMariaEligible();
    poh.as(producerHolding(DEMO_PRODUCERS.eligible)).proveEudrEvidence(BUYER_ID, AS_OF_DATE);
    poh.as(issuerSettling(nullifier)).settleCampaign(nullifier);
  });

  it('never exposes a private credential identifier', () => {
    const { blobs } = publicLedgerValues();
    const credential = DEMO_PRODUCERS.eligible;
    for (const [name, value] of [
      ['producerSecretId', credential.producerSecretId],
      ['campaignId', credential.campaignId],
      ['supplierId', credential.supplierId],
      ['admin secret key', ADMIN_SECRET],
    ] as const) {
      expect(blobs, `${name} must not appear in public state`).not.toContain(toHex(value));
    }
  });

  it('never exposes a private credential quantity', () => {
    const { numbers } = publicLedgerValues();
    const credential = DEMO_PRODUCERS.eligible;
    // 14,800 (capacity) and 3 (campaign count) are the values the financier is
    // explicitly not entitled to under HANDOFF section 5.4.
    expect(numbers).not.toContain(credential.estimatedSettlementValue);
    expect(numbers).not.toContain(credential.campaignCount);
    expect(numbers).not.toContain(credential.certificationExpiry);
  });

  it('exposes only the request parameters the financier chose themselves', () => {
    const { numbers, blobs } = publicLedgerValues();
    // Public by design: the amount asked for, who asked, and under which policy.
    expect(numbers).toContain(REQUESTED_VALUE);
    expect(numbers).toContain(POLICY.version);
    expect(blobs).toContain(toHex(FINANCIER_ID));
  });

  it('never exposes an issuer secret scalar', () => {
    const { numbers } = publicLedgerValues();
    expect(numbers).not.toContain(EXPORTER.secretScalar);
    expect(numbers).not.toContain(OTHER_ISSUER.secretScalar);
  });
});
