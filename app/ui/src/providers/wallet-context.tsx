import {
  createContext,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { ConnectedAPI, InitialAPI } from "@midnight-ntwrk/dapp-connector-api";

const STORAGE_KEY = "proof-of-harvest_wallet_autoconnect";

/**
 * Proof of Harvest targets Midnight Preprod (see README.md / task scope) —
 * this is not a local devnet demo. If the user's wallet is set to a
 * different network, `connect` below detects the mismatch after connecting
 * and surfaces a specific error rather than silently operating against the
 * wrong indexer/node.
 */
const TARGET_NETWORK_ID = "preprod";

export type WalletConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface WalletState {
  status: WalletConnectionStatus;
  connectedApi: ConnectedAPI | null;
  walletName: string | null;
  shieldedAddress: string | null;
  coinPublicKey: string | null;
  encryptionPublicKey: string | null;
  networkId: string | null;
  error: string | null;
}

export interface WalletContextValue extends WalletState {
  connect: () => Promise<void>;
  disconnect: () => void;
}

export const WalletContext = createContext<WalletContextValue | null>(null);

function findWallet(): InitialAPI | undefined {
  if (typeof window === "undefined" || !window.midnight) return undefined;
  // Each wallet is injected under its own key (a UUID; Lace also aliases itself
  // at `mnLace`). Enumerate and use the first valid wallet; to target a specific
  // wallet, match on `rdns`/`name` instead.
  return Object.values(window.midnight).find(
    (w): w is InitialAPI => w != null && typeof w.connect === "function",
  );
}

/**
 * DApp Connector errors are plain discriminated objects sent across the
 * extension boundary, never class instances — `instanceof` checks on them
 * always fail. See midnight-dapp-dev:dapp-connector's error-handling section.
 */
interface DAppConnectorAPIError {
  type: "DAppConnectorAPIError";
  code: "Disconnected" | "InternalError" | "InvalidRequest" | "PermissionRejected" | "Rejected";
  reason: string;
}

function isDAppConnectorError(err: unknown): err is DAppConnectorAPIError {
  return typeof err === "object" && err !== null && (err as { type?: unknown }).type === "DAppConnectorAPIError";
}

function describeConnectError(err: unknown, walletName: string): string {
  if (isDAppConnectorError(err)) {
    switch (err.code) {
      case "PermissionRejected":
        return `Connection request was declined in ${walletName}. Open the extension and approve the connection to continue.`;
      case "Rejected":
        return `${walletName} rejected the request: ${err.reason || "no reason given"}.`;
      case "Disconnected":
        return `${walletName} reports it is disconnected. Open the extension and try again.`;
      case "InvalidRequest":
        return `${walletName} reported an invalid request: ${err.reason || "unknown reason"}.`;
      case "InternalError":
        return `${walletName} reported an internal error: ${err.reason || "unknown reason"}. If a popup did not appear, it may have been blocked — check for a blocked extension popup icon in the address bar.`;
      default:
        return err.reason || "Failed to connect to wallet";
    }
  }
  if (typeof err === "object" && err !== null && "reason" in err) {
    return String((err as { reason: unknown }).reason);
  }
  return `Failed to connect to ${walletName}. If a popup did not appear, check for a blocked-popup indicator in the browser toolbar.`;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WalletState>({
    status: "disconnected",
    connectedApi: null,
    walletName: null,
    shieldedAddress: null,
    coinPublicKey: null,
    encryptionPublicKey: null,
    networkId: null,
    error: null,
  });

  const connect = useCallback(async () => {
    setState((prev) => ({ ...prev, status: "connecting", error: null }));

    const wallet = findWallet();
    if (!wallet) {
      setState((prev) => ({
        ...prev,
        status: "error",
        error:
          "No Midnight wallet extension found. Install a Midnight-compatible wallet (Lace or 1AM) and reload this page to continue.",
      }));
      return;
    }

    try {
      const api = await wallet.connect(TARGET_NETWORK_ID);
      const config = await api.getConfiguration();

      if (config.networkId !== TARGET_NETWORK_ID) {
        setState((prev) => ({
          ...prev,
          status: "error",
          connectedApi: null,
          walletName: wallet.name,
          networkId: config.networkId,
          error: `${wallet.name} is connected to "${config.networkId}", but Proof of Harvest targets "${TARGET_NETWORK_ID}". Switch the network in ${wallet.name}'s settings and reconnect.`,
        }));
        return;
      }

      const addresses = await api.getShieldedAddresses();

      setState({
        status: "connected",
        connectedApi: api,
        walletName: wallet.name,
        shieldedAddress: addresses.shieldedAddress,
        coinPublicKey: addresses.shieldedCoinPublicKey,
        encryptionPublicKey: addresses.shieldedEncryptionPublicKey,
        networkId: config.networkId,
        error: null,
      });

      localStorage.setItem(STORAGE_KEY, "true");
    } catch (err: unknown) {
      setState((prev) => ({
        ...prev,
        status: "error",
        walletName: wallet.name,
        error: describeConnectError(err, wallet.name),
      }));
    }
  }, []);

  const disconnect = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setState({
      status: "disconnected",
      connectedApi: null,
      walletName: null,
      shieldedAddress: null,
      coinPublicKey: null,
      encryptionPublicKey: null,
      networkId: null,
      error: null,
    });
  }, []);

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY) === "true") {
      connect();
    }
    // Only ever run this once on mount: `connect` is stable (empty dep
    // array), and re-running on every `connect` identity change would defeat
    // the "only auto-connect once per fresh page load" intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <WalletContext.Provider value={{ ...state, connect, disconnect }}>
      {children}
    </WalletContext.Provider>
  );
}
