/**
 * Local simulator for the Proof of Harvest contract.
 *
 * Runs circuits against `@midnight-ntwrk/compact-runtime` in-process — no node,
 * no proof server, no proof generation. This exercises the full Impact
 * transcript and every `assert` in the circuit, which is what the acceptance
 * criteria are about; it does not exercise PLONK proving.
 *
 * Multi-actor model: the public ledger is shared, but each participant has their
 * own private state. `as(privateState)` swaps in one actor's private state for
 * the next call only. Successful calls advance the shared public state; the
 * base private state is never overwritten by another actor's call, and failed
 * calls advance nothing.
 */

import {
  createCircuitContext,
  createConstructorContext,
  sampleContractAddress,
  type CircuitContext,
} from '@midnight-ntwrk/compact-runtime';
import {
  Contract,
  ledger,
  type CampaignCommitment,
  type EudrEvidenceResult,
  type FinancingPolicy,
  type IssuerRecord,
  type Ledger,
} from '../managed/ProofOfHarvest/contract/index.js';
import { witnesses, type PoHPrivateState } from '../witnesses.js';

/**
 * The simulator does not model Zswap coins, so a fixed all-zero coin public key
 * is used throughout. Authorization in this contract never depends on it.
 */
const COIN_PUBLIC_KEY = '0'.repeat(64);

/** Simulated chain time, in Unix seconds. Fixed so tests are deterministic. */
export const DEFAULT_CHAIN_TIME = 1_800_000_000;

export class ProofOfHarvestSimulator {
  readonly contract: Contract<PoHPrivateState>;
  private context: CircuitContext<PoHPrivateState>;
  private pendingPrivateState: PoHPrivateState | undefined;

  readonly contractAddress: string;

  constructor(
    policy: FinancingPolicy,
    deployerPrivateState: PoHPrivateState,
    chainTime: number = DEFAULT_CHAIN_TIME,
  ) {
    this.contract = new Contract<PoHPrivateState>(witnesses);
    const initial = this.contract.initialState(
      createConstructorContext(deployerPrivateState, COIN_PUBLIC_KEY),
      policy,
    );
    this.contractAddress = sampleContractAddress();
    this.context = createCircuitContext(
      this.contractAddress,
      COIN_PUBLIC_KEY,
      initial.currentContractState,
      initial.currentPrivateState,
      undefined,
      undefined,
      chainTime,
    );
  }

  /** Acts as the participant holding `privateState`, for the next call only. */
  as(privateState: PoHPrivateState): this {
    this.pendingPrivateState = privateState;
    return this;
  }

  private takeContext(): CircuitContext<PoHPrivateState> {
    if (this.pendingPrivateState === undefined) {
      return this.context;
    }
    const scoped = { ...this.context, currentPrivateState: this.pendingPrivateState };
    this.pendingPrivateState = undefined;
    return scoped;
  }

  /**
   * Commits only the public/shared parts of the resulting context. The caller's
   * private state stays with the caller — it is not promoted into shared state.
   */
  private commit(result: {
    context: CircuitContext<PoHPrivateState>;
  }): void {
    this.context = {
      ...this.context,
      currentQueryContext: result.context.currentQueryContext,
      currentZswapLocalState: result.context.currentZswapLocalState,
    };
  }

  /** The public ledger state, exactly as an on-chain observer would read it. */
  ledger(): Ledger {
    return ledger(this.context.currentQueryContext.state);
  }

  // --- circuits -------------------------------------------------------------

  registerIssuer(issuerId: Uint8Array, pubKey: { x: bigint; y: bigint }): void {
    const result = this.contract.impureCircuits.registerIssuer(
      this.takeContext(),
      issuerId,
      pubKey,
    );
    this.commit(result);
  }

  revokeIssuer(issuerId: Uint8Array): void {
    const result = this.contract.impureCircuits.revokeIssuer(this.takeContext(), issuerId);
    this.commit(result);
  }

  /** Returns the campaign nullifier reserved by this proof. */
  proveCampaignEligibility(
    requesterId: Uint8Array,
    requestedValue: bigint,
    asOfDate: bigint,
  ): Uint8Array {
    const result = this.contract.impureCircuits.proveCampaignEligibility(
      this.takeContext(),
      requesterId,
      requestedValue,
      asOfDate,
    );
    this.commit(result);
    return result.result;
  }

  settleCampaign(nullifier: Uint8Array): void {
    const result = this.contract.impureCircuits.settleCampaign(this.takeContext(), nullifier);
    this.commit(result);
  }

  /** Returns the EUDR evidence reference recorded by this proof. */
  proveEudrEvidence(buyerId: Uint8Array, asOfDate: bigint): Uint8Array {
    const result = this.contract.impureCircuits.proveEudrEvidence(
      this.takeContext(),
      buyerId,
      asOfDate,
    );
    this.commit(result);
    return result.result;
  }

  // --- ledger reads ---------------------------------------------------------

  issuer(issuerId: Uint8Array): IssuerRecord | undefined {
    const { issuers } = this.ledger();
    return issuers.member(issuerId) ? issuers.lookup(issuerId) : undefined;
  }

  commitment(nullifier: Uint8Array): CampaignCommitment | undefined {
    const { commitments } = this.ledger();
    return commitments.member(nullifier) ? commitments.lookup(nullifier) : undefined;
  }

  eudrAttestation(reference: Uint8Array): EudrEvidenceResult | undefined {
    const { eudrAttestations } = this.ledger();
    return eudrAttestations.member(reference)
      ? eudrAttestations.lookup(reference)
      : undefined;
  }
}
