/**
 * Browser-local persistence for this hackathon MVP.
 *
 * There is no backend yet (see CLAUDE.md and the task boundary: "No
 * backend/PostgreSQL layer yet"). Everything that would normally live in an
 * exporter's operational database — which demo producer has which signed
 * credential, the issuer keypair used to sign them, the admin secret used to
 * prove registry-admin actions, the deployed contract's address — lives in
 * this browser's `localStorage` instead, under one JSON blob.
 *
 * This is deliberately a single shared store rather than one store per
 * "role": the whole demo runs in one browser tab against one connected Lace
 * wallet, with the UI's role tabs (Exporter Console / Producer View /
 * Financier Dashboard / Buyer view) acting as different *perspectives* on
 * the same shared state — not different users. Real deployments would split
 * this across an exporter backend, each producer's own device, and the
 * financier's own systems; nothing here is a substitute for that.
 */

import type { CampaignCredential, FinancingPolicy, IssuerKeyPair, SchnorrSignature } from "proof-of-harvest-api";
import { fromJSON, toJSON } from "./serialize";

const STORAGE_KEY = "poh:demo-store:v1";

export interface ProducerRecord {
  /** Display label only ("María", "Jorge", "Rosa") — never sent on-chain. */
  label: string;
  /** One-line narrative shown in the Producer View, matching HANDOFF section 5. */
  narrative: string;
  requestedValue: bigint;
  credential: CampaignCredential;
  /** Set once the Exporter Console issues (signs) this producer's credential. */
  signature?: SchnorrSignature;
  issuerId?: Uint8Array;
  lastEligibility?: {
    nullifier: string;
    eligible: boolean;
    error?: string;
    txId?: string;
    when: number;
  };
  lastSettlement?: { txId: string; when: number };
  lastEudr?: { evidenceRef: string; buyerId: string; txId?: string; when: number };
}

export interface DemoStore {
  contractAddress?: string;
  /** The registry admin's / exporter's local identity secret (never a wallet seed). */
  adminSecretHex?: string;
  policy?: FinancingPolicy;
  /** The policy's full authorized-supplier list, padded to AUTHORIZED_SUPPLIER_SLOTS. */
  supplierList?: Uint8Array[];
  issuer?: {
    idHex: string;
    keyPair: IssuerKeyPair;
  };
  financierId?: Uint8Array;
  buyerId?: Uint8Array;
  producers: Record<string, ProducerRecord>;
}

function emptyStore(): DemoStore {
  return { producers: {} };
}

export function loadStore(): DemoStore {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return emptyStore();
  try {
    return { ...emptyStore(), ...fromJSON<DemoStore>(raw) };
  } catch (err) {
    console.error("demo-store: failed to parse stored state, resetting", err);
    return emptyStore();
  }
}

export function saveStore(store: DemoStore): void {
  localStorage.setItem(STORAGE_KEY, toJSON(store));
  // Notify same-tab listeners; the native `storage` event only fires for
  // *other* tabs/windows, so `useDemoStore` also listens for this.
  window.dispatchEvent(new CustomEvent("poh:demo-store-changed"));
}

export function updateStore(fn: (store: DemoStore) => DemoStore): DemoStore {
  const next = fn(loadStore());
  saveStore(next);
  return next;
}

export function clearStore(): void {
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new CustomEvent("poh:demo-store-changed"));
}
