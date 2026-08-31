/**
 * Read-only diagnostic: fetches a deployed PoH contract's public ledger
 * state straight from the Preprod indexer, bypassing the browser entirely.
 * Used to check whether a commitment the UI reports as "eligible" actually
 * landed on-chain, independent of any frontend bug.
 */
import ws from 'ws';
(globalThis as unknown as { WebSocket: unknown }).WebSocket = ws;

import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { firstValueFrom } from 'rxjs';
import {
  ledgerStateObservable,
  type AppProviders,
} from '../../../app/api/src/index.js';

const CONTRACT_ADDRESS = process.argv[2];
if (!CONTRACT_ADDRESS) {
  console.error('Usage: tsx src/check-state.ts <contractAddress>');
  process.exit(1);
}

const INDEXER_HTTP = 'https://indexer.preprod.midnight.network/api/v4/graphql';
const INDEXER_WS = 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws';

function hex(bytes: Uint8Array): string {
  return '0x' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function main() {
  setNetworkId('preprod' as never);
  const publicDataProvider = indexerPublicDataProvider(
    INDEXER_HTTP,
    INDEXER_WS,
    ws as unknown as typeof WebSocket,
  ) as AppProviders['publicDataProvider'];

  console.log(`Fetching ledger state for ${CONTRACT_ADDRESS} ...`);
  const state = await firstValueFrom(ledgerStateObservable(publicDataProvider, CONTRACT_ADDRESS));

  console.log('\n--- issuers ---');
  for (const [id, record] of state.issuers as Iterable<[Uint8Array, { active: boolean }]>) {
    console.log(hex(id), record.active ? 'active' : 'revoked');
  }

  console.log('\n--- commitments ---');
  let count = 0;
  for (const [nullifier, c] of state.commitments as Iterable<
    [Uint8Array, { status: number; requesterId: Uint8Array; issuerId: Uint8Array; requestedValue: bigint; provenAt: bigint }]
  >) {
    count += 1;
    console.log({
      nullifier: hex(nullifier),
      status: ['none', 'reserved', 'settled'][c.status],
      requesterId: hex(c.requesterId),
      issuerId: hex(c.issuerId),
      requestedValue: c.requestedValue.toString(),
      provenAt: c.provenAt.toString(),
    });
  }
  if (count === 0) console.log('(empty)');

  console.log('\n--- eudrAttestations ---');
  let eudrCount = 0;
  for (const [ref, a] of state.eudrAttestations as Iterable<
    [Uint8Array, { policyVersion: bigint; issuerId: Uint8Array; buyerId: Uint8Array; provenAt: bigint }]
  >) {
    eudrCount += 1;
    console.log({
      evidenceRef: hex(ref),
      policyVersion: a.policyVersion.toString(),
      issuerId: hex(a.issuerId),
      buyerId: hex(a.buyerId),
      provenAt: a.provenAt.toString(),
    });
  }
  if (eudrCount === 0) console.log('(empty)');

  process.exit(0);
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
