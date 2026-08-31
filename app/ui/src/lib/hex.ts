/** Byte-level helpers shared across the demo store, fixtures and views. */

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return `0x${out}`;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) {
    throw new Error(`hexToBytes: odd-length hex string "${hex}"`);
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * UTF-8 encodes a short label into a fixed 32-byte identifier, zero-padded on
 * the right. Mirrors `id32` in contract/src/test/fixtures.ts so labels used
 * by this UI (issuer ids, supplier ids, requester/buyer ids) are produced
 * the same way the contract's own tests produce theirs.
 */
export function id32(label: string): Uint8Array {
  const encoded = new TextEncoder().encode(label);
  if (encoded.length > 32) {
    throw new Error(`id32: "${label}" encodes to ${encoded.length} bytes, max 32`);
  }
  const out = new Uint8Array(32);
  out.set(encoded);
  return out;
}

/** A fresh, CSPRNG-backed 32-byte secret (producer secret ids, local admin secret). */
export function randomBytes32(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

export function truncateHex(hex: string, lead = 10, tail = 6): string {
  if (hex.length <= lead + tail + 3) return hex;
  return `${hex.slice(0, lead)}…${hex.slice(-tail)}`;
}
