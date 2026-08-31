/**
 * The single place this package reaches across the workspace into
 * `@poh/contract`'s source.
 *
 * The contract package ships no build step of its own beyond compiling the
 * `.compact` source (see contract/package.json: `compile`/`compile:zk`
 * produce `src/managed/`, but there is no `tsc` emit step). `witnesses.ts`
 * and `issuer.ts` are plain TypeScript, resolved directly by Vite/esbuild the
 * same way any other project source file is — this is a workspace source
 * dependency, not a published-package dependency, so every import below is a
 * relative path rather than a `@poh/contract` package-name import (the
 * package has no `main`/`exports` field to resolve against, by design: it is
 * not meant to be consumed as a built artifact).
 *
 * Every other module in this package should import contract bindings from
 * here rather than reaching into `../../../contract` directly, so there is
 * exactly one place to update if the contract's output layout ever moves.
 *
 * This file only ever *reads* from contract/src — nothing here modifies the
 * contract, per the project boundary that contract/ is done and tested.
 */

export {
  Contract,
  ledger,
  pureCircuits,
  EvidenceStatus,
  CommitmentStatus,
} from "../../../contract/src/managed/ProofOfHarvest/contract/index.js";
export type {
  Ledger,
  CampaignCredential,
  CampaignCommitment,
  IssuerRecord,
  EudrEvidenceResult,
  FinancingPolicy,
  Schnorr_SchnorrSignature,
  Witnesses,
} from "../../../contract/src/managed/ProofOfHarvest/contract/index.js";

export { witnesses, AUTHORIZED_SUPPLIER_SLOTS } from "../../../contract/src/witnesses";
export type {
  PoHPrivateState,
  HeldCredential,
  HeldSettlementAttestation,
} from "../../../contract/src/witnesses";

export {
  issuerKeyPairFromSeed,
  signCredential,
  signSettlement,
  JUBJUB_SUBGROUP_ORDER,
} from "../../../contract/src/issuer";
export type { IssuerKeyPair } from "../../../contract/src/issuer";
