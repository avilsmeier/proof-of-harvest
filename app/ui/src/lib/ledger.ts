/**
 * The compiled contract's Map-shaped ledger fields (`issuers`, `commitments`,
 * `eudrAttestations`) expose `[Symbol.iterator]` but aren't a nominal
 * `Iterable<T>`/`Map<K,V>` — structurally they satisfy `Iterable<[K, V]>`,
 * but `Array.from` on them resolves against a `lib.es2023`
 * Iterator-helpers-aware overload that infers `unknown` element types
 * instead. A plain `for...of` always works against anything exposing
 * `[Symbol.iterator]`, so collect entries that way instead of via
 * `Array.from`.
 */
export function entriesOf<K, V>(iterable: { [Symbol.iterator](): Iterator<[K, V]> }): Array<[K, V]> {
  const out: Array<[K, V]> = [];
  for (const entry of iterable) out.push(entry);
  return out;
}
