/**
 * Deploy/join wiring for the Proof of Harvest contract.
 *
 * A single `compiledContract` binding is shared by every deploy/join call in
 * the app: it pairs the compiled circuits with the TypeScript witness
 * implementation and points the verifier-key reader at the ZK assets served
 * from this app's own `public/` directory (see app/ui/package.json's
 * `copy-contract-keys` script, and README.md for why assets are duplicated
 * under both `/keys` + `/zkir` and `/managed/ProofOfHarvest`).
 */

import { CompiledContract } from "@midnight-ntwrk/compact-js";
import {
  deployContract,
  findDeployedContract,
  type DeployedContract,
  type FoundContract,
} from "@midnight-ntwrk/midnight-js-contracts";
import type { PrivateStateId } from "@midnight-ntwrk/midnight-js-types";
import { Contract, ledger, witnesses, type Ledger, type PoHPrivateState, type FinancingPolicy } from "./contract-bindings";
import type { AppProviders } from "./types";

const compiledContract = CompiledContract.make("ProofOfHarvest", Contract).pipe(
  CompiledContract.withWitnesses(witnesses),
  // Resolved relative to window.location.origin in the browser. The actual
  // proving/verifying assets are fetched over HTTP by the zkConfigProvider
  // (FetchZkConfigProvider) configured in index.ts; this path is a second,
  // narrower "where do the verifier keys live" pointer that compact-js's
  // lower-level ContractExecutable layer can also consult. Left empty (site
  // root) to match the same /keys and /zkir layout the zkConfigProvider
  // uses — see app/ui/package.json's copy-contract-keys script.
  CompiledContract.withCompiledFileAssets(""),
);

export type PoHContract = Contract<PoHPrivateState, typeof witnesses>;
export type { Ledger } from "./contract-bindings";
export type PoHDeployedContract = DeployedContract<PoHContract>;
export type PoHFoundContract = FoundContract<PoHContract>;

/** Parses the raw indexer ledger bytes into the typed public state. */
export function parseLedger(data: Parameters<typeof ledger>[0]): Ledger {
  return ledger(data);
}

/**
 * Deploys a fresh instance of the contract, sealing `policy` in at
 * construction time (the contract's constructor takes exactly one argument —
 * see ProofOfHarvest.compact — so this policy can never change for the
 * lifetime of this deployment; a new policy version means a new deployment).
 *
 * `privateStateId`/`initialPrivateState` here is always the *deployer's* role
 * — in this app, the Exporter Console, since deploying is an admin action.
 */
export async function deploy(
  providers: AppProviders,
  privateStateId: PrivateStateId,
  initialPrivateState: PoHPrivateState,
  policy: FinancingPolicy,
): Promise<DeployedContract<PoHContract>> {
  return deployContract(providers, {
    compiledContract,
    privateStateId,
    initialPrivateState,
    args: [policy],
  });
}

/**
 * Attaches to an already-deployed contract under a given role's private
 * state slot. Called once per role the first time that role is used in this
 * browser session (see role-contracts.tsx on the UI side, which caches the
 * resulting handle so repeated calls don't re-attach).
 */
export async function join(
  providers: AppProviders,
  contractAddress: string,
  privateStateId: PrivateStateId,
  initialPrivateState: PoHPrivateState,
): Promise<FoundContract<PoHContract>> {
  return findDeployedContract(providers, {
    compiledContract,
    contractAddress,
    privateStateId,
    initialPrivateState,
  });
}
