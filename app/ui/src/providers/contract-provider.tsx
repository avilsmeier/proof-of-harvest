import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  deploy as apiDeploy,
  join as apiJoin,
  ledgerStateObservable,
  privateStateId,
  type ContractState,
  type FinancingPolicy,
  type PoHFoundContract,
  type PrivateState,
  type Role,
} from "proof-of-harvest-api";
import { useMidnightProviders } from "@/providers/midnight-providers";
import { useDemoStore } from "@/hooks/use-demo-store";

interface ContractContextValue {
  contractAddress: string | null;
  ledgerState: ContractState | null;
  ledgerError: string | null;
  deploying: boolean;
  deployError: string | null;
  /** Deploys a fresh contract instance, sealing `policy` in permanently. */
  deploy: (policy: FinancingPolicy, adminSecret: Uint8Array) => Promise<void>;
  /**
   * Attaches to the deployed contract under `role`'s own private-state slot
   * (see `Role`/`privateStateId` in the api package). Cached per role for
   * the lifetime of this contract address, so switching between the demo's
   * role tabs does not re-attach on every render.
   */
  getRoleHandle: (role: Role, initialPrivateState: PrivateState) => Promise<PoHFoundContract>;
  /** Forgets the locally-stored contract address (does not touch the chain). */
  forgetContract: () => void;
}

const ContractContext = createContext<ContractContextValue | null>(null);

export function ContractProvider({ children }: { children: ReactNode }) {
  const { providers, isReady } = useMidnightProviders();
  const [store, updateStore] = useDemoStore();
  const contractAddress = store.contractAddress ?? null;

  const [ledgerState, setLedgerState] = useState<ContractState | null>(null);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);

  // One handle cache per contract address: a Map from role -> in-flight/joined
  // handle promise, so concurrent calls for the same role share one join().
  const handleCacheRef = useRef<{ address: string | null; cache: Map<string, Promise<PoHFoundContract>> }>({
    address: null,
    cache: new Map(),
  });

  useEffect(() => {
    if (!isReady || !providers || !contractAddress) {
      setLedgerState(null);
      return;
    }
    setLedgerError(null);
    const subscription = ledgerStateObservable(providers.publicDataProvider, contractAddress).subscribe({
      next: (state) => setLedgerState(state),
      error: (err) => setLedgerError(err instanceof Error ? err.message : String(err)),
    });
    return () => subscription.unsubscribe();
  }, [isReady, providers, contractAddress]);

  const deploy = useCallback(
    async (policy: FinancingPolicy, adminSecret: Uint8Array) => {
      if (!providers) throw new Error("Wallet is not connected yet");
      setDeploying(true);
      setDeployError(null);
      try {
        const deployed = await apiDeploy(providers, privateStateId("exporter"), { localSecretKey: adminSecret }, policy);
        const address = deployed.deployTxData.public.contractAddress;
        handleCacheRef.current = { address, cache: new Map([["exporter", Promise.resolve(deployed)]]) };
        updateStore((s) => ({ ...s, contractAddress: address }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setDeployError(message);
        throw err;
      } finally {
        setDeploying(false);
      }
    },
    [providers, updateStore],
  );

  const getRoleHandle = useCallback(
    (role: Role, initialPrivateState: PrivateState): Promise<PoHFoundContract> => {
      if (!providers) return Promise.reject(new Error("Wallet is not connected yet"));
      // Prefer the ref over the closured `contractAddress`: `deploy()` writes
      // the fresh address into the ref synchronously, but a `getRoleHandle`
      // closure captured before deploy resolved would otherwise still see
      // the pre-deploy (null) state value and reject spuriously.
      const address = contractAddress ?? handleCacheRef.current.address;
      if (!address) return Promise.reject(new Error("No contract has been deployed yet"));

      if (handleCacheRef.current.address !== address) {
        handleCacheRef.current = { address, cache: new Map() };
      }
      const cache = handleCacheRef.current.cache;
      const existing = cache.get(role);
      if (existing) return existing;

      const handlePromise = apiJoin(providers, address, privateStateId(role), initialPrivateState);
      cache.set(role, handlePromise);
      handlePromise.catch(() => cache.delete(role));
      return handlePromise;
    },
    [providers, contractAddress],
  );

  const forgetContract = useCallback(() => {
    handleCacheRef.current = { address: null, cache: new Map() };
    updateStore((s) => ({ ...s, contractAddress: undefined }));
  }, [updateStore]);

  const value = useMemo<ContractContextValue>(
    () => ({
      contractAddress,
      ledgerState,
      ledgerError,
      deploying,
      deployError,
      deploy,
      getRoleHandle,
      forgetContract,
    }),
    [contractAddress, ledgerState, ledgerError, deploying, deployError, deploy, getRoleHandle, forgetContract],
  );

  return <ContractContext.Provider value={value}>{children}</ContractContext.Provider>;
}

export function useContract(): ContractContextValue {
  const ctx = useContext(ContractContext);
  if (!ctx) throw new Error("useContract must be used within a ContractProvider");
  return ctx;
}
