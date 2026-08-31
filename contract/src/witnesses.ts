/**
 * TypeScript witness implementations for Proof of Harvest.
 *
 * Witnesses run entirely on the prover's own machine. Everything they return is
 * confidential — it never appears in the transaction — but it is also
 * *untrusted*: the contract cannot assume a prover supplied honest values. That
 * is why every witness value the contract relies on is either checked against a
 * registered issuer's signature (the credential, the settlement authorization),
 * checked against an on-chain digest (the authorized supplier list), or used
 * only to derive an identity that is compared against on-chain state (the local
 * secret key).
 */

import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import type {
  CampaignCredential,
  Ledger,
  Schnorr_SchnorrSignature,
} from './managed/ProofOfHarvest/contract/index.js';

/** Number of slots in the policy's authorized supplier list. */
export const AUTHORIZED_SUPPLIER_SLOTS = 8;

/**
 * A credential as held by a producer: the issuer's attested values, the
 * issuer's signature over them, and which registered issuer signed.
 */
export interface HeldCredential {
  readonly credential: CampaignCredential;
  readonly signature: Schnorr_SchnorrSignature;
  readonly issuerId: Uint8Array;
}

/** An issuer's authorization to settle a specific registered campaign. */
export interface HeldSettlementAttestation {
  readonly signature: Schnorr_SchnorrSignature;
  readonly issuerId: Uint8Array;
}

/**
 * Everything a Proof of Harvest participant keeps off-chain.
 *
 * In a deployed system this lives in the participant's own wallet-adjacent
 * private state store, not in the shared database: the exporter's PostgreSQL
 * holds the operational records, but the *credential the producer proves with*
 * is the producer's to hold.
 *
 * Fields are optional because a single type serves several roles — the registry
 * admin holds only a secret key, a producer holds a credential, an exporter
 * holds a settlement authorization.
 */
export interface PoHPrivateState {
  /** Local identity secret. The admin's derived id is pinned on-chain. */
  readonly localSecretKey: Uint8Array;
  readonly heldCredential?: HeldCredential;
  readonly settlementAttestation?: HeldSettlementAttestation;
  /** The policy's authorized supplier list, exactly AUTHORIZED_SUPPLIER_SLOTS long. */
  readonly authorizedSuppliers?: readonly Uint8Array[];
}


type Ctx = WitnessContext<Ledger, PoHPrivateState>;

export const witnesses = {
  /**
   * The prover's local identity secret. `deriveAdminId` hashes this in-circuit
   * and compares the result against the pinned `admin` ledger field, so holding
   * the secret is what proves the admin role. `ownPublicKey()` is deliberately
   * not used anywhere: it returns a value the prover claims, with no
   * cryptographic binding to the transaction signer, so any check based on it
   * is bypassable.
   */
  localSecretKey: ({ privateState }: Ctx): [PoHPrivateState, Uint8Array] => {
    if (privateState.localSecretKey.length !== 32) {
      throw new Error('localSecretKey: expected a 32-byte secret');
    }
    return [privateState, privateState.localSecretKey];
  },

  /**
   * The producer's signed productive credential. The contract re-verifies the
   * signature against the registered issuer's public key, so a producer who
   * edits any field here fails the proof rather than gaining eligibility.
   */
  campaignCredential: ({
    privateState,
  }: Ctx): [
    PoHPrivateState,
    [CampaignCredential, Schnorr_SchnorrSignature, Uint8Array],
  ] => {
    const held = privateState.heldCredential;
    if (held === undefined) {
      throw new Error(
        'campaignCredential: this participant holds no productive credential; ' +
          'the exporter or certifier must issue one first',
      );
    }
    return [privateState, [held.credential, held.signature, held.issuerId]];
  },

  /**
   * The issuing organization's authorization to close a campaign commitment.
   * Verified in-circuit against the issuer recorded on the commitment, so only
   * the organization that attested the credential can settle it.
   */
  settlementAttestation: ({
    privateState,
  }: Ctx): [PoHPrivateState, [Schnorr_SchnorrSignature, Uint8Array]] => {
    const attestation = privateState.settlementAttestation;
    if (attestation === undefined) {
      throw new Error(
        'settlementAttestation: this participant holds no settlement authorization',
      );
    }
    return [privateState, [attestation.signature, attestation.issuerId]];
  },

  /**
   * The policy's authorized supplier list.
   *
   * Supplied privately so the circuit can prove the producer's supplier is on
   * the list without disclosing which entry matched — a public `Set.member`
   * check would publish the supplier's identity on-chain, which the product
   * model treats as commercially sensitive. The circuit hashes this list and
   * compares it against `policy.supplierSetHash`, so substituting a list
   * containing an unauthorized supplier fails the proof.
   */
  authorizedSupplierList: ({ privateState }: Ctx): [PoHPrivateState, Uint8Array[]] => {
    const suppliers = privateState.authorizedSuppliers;
    if (suppliers === undefined) {
      throw new Error('authorizedSupplierList: no authorized supplier list available');
    }
    if (suppliers.length !== AUTHORIZED_SUPPLIER_SLOTS) {
      throw new Error(
        `authorizedSupplierList: expected exactly ${AUTHORIZED_SUPPLIER_SLOTS} entries, ` +
          `got ${suppliers.length}`,
      );
    }
    return [privateState, suppliers.map((entry) => entry)];
  },
};

// Note: there is deliberately no `getSchnorrReduction` witness. The upstream
// Schnorr polyfill asked the prover for the quotient and remainder of the
// challenge hash, which turned out to be a universal signature forgery — the
// quotient was unconstrained, so a prover could choose any in-range remainder.
// `src/schnorr.compact` now truncates the challenge deterministically in-circuit
// with no prover input at all. See that file's header for the full analysis.
