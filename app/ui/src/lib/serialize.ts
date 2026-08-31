/**
 * Generic bigint/Uint8Array-safe JSON round-trip.
 *
 * Every contract-facing type this app persists (CampaignCredential,
 * FinancingPolicy, Schnorr signatures, JubjubPoint public keys) is built
 * entirely out of plain objects, bigints, Uint8Arrays, booleans and enum
 * numbers. Tagging bigints and byte arrays at every leaf, rather than
 * hand-writing a `toWire`/`fromWire` pair per struct, means new fields (or
 * whole new credential shapes) round-trip through localStorage for free.
 */

import { bytesToHex, hexToBytes } from "./hex";

const BIGINT_TAG = "bigint:";
const BYTES_TAG = "bytes:";

function replacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return `${BIGINT_TAG}${value.toString()}`;
  if (value instanceof Uint8Array) return `${BYTES_TAG}${bytesToHex(value)}`;
  return value;
}

function reviver(_key: string, value: unknown): unknown {
  if (typeof value === "string") {
    if (value.startsWith(BIGINT_TAG)) return BigInt(value.slice(BIGINT_TAG.length));
    if (value.startsWith(BYTES_TAG)) return hexToBytes(value.slice(BYTES_TAG.length));
  }
  return value;
}

export function toJSON(value: unknown): string {
  return JSON.stringify(value, replacer);
}

export function fromJSON<T>(text: string): T {
  return JSON.parse(text, reviver) as T;
}
