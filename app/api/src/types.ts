import type { MidnightProviders, PrivateStateId } from "@midnight-ntwrk/midnight-js-types";
import type { Ledger, PoHPrivateState } from "./contract-bindings";

export type {
  Ledger as ContractState,
  CampaignCredential,
  CampaignCommitment,
  IssuerRecord,
  EudrEvidenceResult,
  FinancingPolicy,
  Schnorr_SchnorrSignature as SchnorrSignature,
} from "./contract-bindings";
export { EvidenceStatus, CommitmentStatus } from "./contract-bindings";
export type {
  PoHPrivateState as PrivateState,
  HeldCredential,
  HeldSettlementAttestation,
} from "./contract-bindings";
export { AUTHORIZED_SUPPLIER_SLOTS } from "./contract-bindings";

/**
 * The five circuits that produce a ZK proof (i.e. carry a prover/verifier key
 * pair under `managed/ProofOfHarvest/keys`, fetched by the zk config
 * provider). `deriveAdminId`, `credentialMessage` and the other pure circuits
 * are called directly through `pureCircuits` and never go through this key
 * union or a wallet transaction.
 */
export type ImpureCircuitKeys =
  | "registerIssuer"
  | "revokeIssuer"
  | "proveCampaignEligibility"
  | "settleCampaign"
  | "proveEudrEvidence";

/**
 * This demo runs every role — registry admin/exporter, each demo producer,
 * the financier's read-only view, the EUDR buyer's view — inside one browser
 * tab against one connected Lace wallet. A single `PrivateStateProvider`
 * entry cannot hold more than one role's secrets at once (an admin's
 * `localSecretKey` and a producer's `heldCredential` are different values
 * under the same field), so each role gets its own private-state slot rather
 * than sharing one constant `PRIVATE_STATE_ID`. The financier and buyer
 * views never submit a proving transaction themselves in this MVP (see
 * README), so they need no slot of their own.
 */
export type Role = "exporter" | `producer:${string}`;

export function privateStateId(role: Role): PrivateStateId {
  return `poh:${role}`;
}

export interface DerivedState {
  contractState: Ledger | null;
  privateState: PoHPrivateState | null;
}

export type AppProviders = MidnightProviders<ImpureCircuitKeys, PrivateStateId, PoHPrivateState>;
