import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { FetchZkConfigProvider } from "@midnight-ntwrk/midnight-js-fetch-zk-config-provider";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { dappConnectorProofProvider } from "@midnight-ntwrk/midnight-js-dapp-connector-proof-provider";
import { toHex, fromHex } from "@midnight-ntwrk/midnight-js-utils";
import { CostModel, Transaction, type FinalizedTransaction } from "@midnight-ntwrk/ledger-v8";
import type { ChargedState } from "@midnight-ntwrk/compact-runtime";
import type { ConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";
import type { WalletProvider, MidnightProvider, PrivateStateId } from "@midnight-ntwrk/midnight-js-types";
import { map, retry, type Observable } from "rxjs";
import { inMemoryPrivateStateProvider } from "./private-state.js";
import type { AppProviders, ImpureCircuitKeys, PrivateState } from "./types.js";
import { parseLedger } from "./contract.js";
import type { Ledger } from "./contract-bindings";

export { inMemoryPrivateStateProvider } from "./private-state.js";
export type {
  AppProviders,
  ContractState,
  DerivedState,
  ImpureCircuitKeys,
  PrivateState,
  HeldCredential,
  HeldSettlementAttestation,
  CampaignCredential,
  CampaignCommitment,
  IssuerRecord,
  EudrEvidenceResult,
  FinancingPolicy,
  SchnorrSignature,
  Role,
} from "./types.js";
export { AUTHORIZED_SUPPLIER_SLOTS, EvidenceStatus, CommitmentStatus, privateStateId } from "./types.js";
export { deploy, join, parseLedger } from "./contract.js";
export type { PoHContract, PoHDeployedContract, PoHFoundContract, Ledger } from "./contract.js";
export {
  witnesses,
  pureCircuits,
  issuerKeyPairFromSeed,
  signCredential,
  signSettlement,
} from "./contract-bindings";
export type { IssuerKeyPair } from "./contract-bindings";

function deriveProofServerUri(substrateNodeUri: string): string {
  try {
    const url = new URL(substrateNodeUri);
    url.port = "6300";
    url.pathname = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "http://localhost:6300";
  }
}

export async function createProviders(api: ConnectedAPI): Promise<AppProviders> {
  const config = await api.getConfiguration();
  setNetworkId(config.networkId);

  // `isomorphic-ws`'s browser build only has a default export (no named
  // `WebSocket`), so the SDK's `webSocketImpl = ws.WebSocket` default
  // resolves to `undefined` in this bundle. Pass the browser's native
  // WebSocket explicitly instead of relying on that default.
  const publicDataProvider = indexerPublicDataProvider(
    config.indexerUri,
    config.indexerWsUri,
    WebSocket,
  );

  const privateStateProvider = inMemoryPrivateStateProvider<PrivateStateId, PrivateState>();

  const zkConfigProvider = new FetchZkConfigProvider<ImpureCircuitKeys>(
    window.location.origin,
    fetch.bind(window),
  );

  // Wallets differ in where proving happens. 1AM implements `getProvingProvider`
  // and proves in-browser via WASM — no local infrastructure needed. Lace does
  // not implement it (the property is simply absent at runtime, hence the
  // `typeof` check rather than an `in` check or trusting the connector's own
  // type, which declares it as always present), so it falls back to a proof
  // server the user must run themselves at `<node-host>:6300`.
  const proofProvider =
    typeof api.getProvingProvider === "function"
      ? await dappConnectorProofProvider<ImpureCircuitKeys>(
          api,
          zkConfigProvider,
          CostModel.initialCostModel(),
        )
      : httpClientProofProvider<ImpureCircuitKeys>(
          deriveProofServerUri(config.substrateNodeUri),
          zkConfigProvider,
        );

  const { shieldedCoinPublicKey, shieldedEncryptionPublicKey } = await api.getShieldedAddresses();

  const walletProvider: WalletProvider = {
    getCoinPublicKey: () => shieldedCoinPublicKey,
    getEncryptionPublicKey: () => shieldedEncryptionPublicKey,
    // WalletProvider.balanceTx is (tx: UnboundTransaction, ttl?: Date) =>
    // Promise<FinalizedTransaction>. The DApp Connector speaks serialized hex
    // strings, so we hex-encode the unbound tx, hand it to Lace (which selects
    // fee inputs/change and binds it), then deserialize the returned hex string
    // back into a FinalizedTransaction. The options object is `{ payFees?:
    // boolean }`; an empty `{}` uses the defaults (payFees: true). There is no
    // `sender`, `newCoins`, or `ttl` argument on this method.
    balanceTx: async (tx, _ttl) => {
      const { tx: balancedHex } = await api.balanceUnsealedTransaction(toHex(tx.serialize()), {});
      // A balanced/finalized tx is Transaction<SignatureEnabled, Proof, Binding>.
      // deserialize takes the three instance markers for those type params.
      return Transaction.deserialize(
        "signature",
        "proof",
        "binding",
        fromHex(balancedHex),
      ) satisfies FinalizedTransaction;
    },
  };

  const midnightProvider: MidnightProvider = {
    submitTx: async (tx) => {
      // submitTransaction takes a serialized hex string and returns void; the
      // tx id is recovered from the transaction's own identifiers().
      await api.submitTransaction(toHex(tx.serialize()));
      return tx.identifiers()[0]!;
    },
  };

  return {
    privateStateProvider,
    publicDataProvider,
    zkConfigProvider,
    proofProvider,
    walletProvider,
    midnightProvider,
  };
}

/**
 * The contract's public ledger state as a live stream. Ledger state is
 * shared across every role (it is the one thing that is NOT
 * role-partitioned, unlike private state — see `Role`/`privateStateId` in
 * types.ts), so this only needs the public data provider and the contract
 * address, independent of which role is currently active.
 */
export function ledgerStateObservable(
  publicDataProvider: AppProviders["publicDataProvider"],
  contractAddress: string,
): Observable<Ledger> {
  return publicDataProvider.contractStateObservable(contractAddress, { type: "latest" }).pipe(
    map((state) => parseLedger(state.data as ChargedState)),
    retry({ delay: 500 }),
  );
}
