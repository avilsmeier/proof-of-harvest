// This file is part of midnight-dust-generator.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//	https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * Midnight DUST Generation Tutorial
 *
 * This script:
 *   1. Creates a new wallet or restores an existing one
 *   2. Displays all wallet addresses (shielded, unshielded, dust)
 *   3. Waits for you to send tNight from the faucet
 *   4. Registers your NIGHT tokens for DUST generation
 *   5. Monitors your DUST balance as it accrues
 */

// ─── Imports ───────────────────────────────────────────────────────────────────

import { WebSocket } from 'ws';
(globalThis as any).WebSocket = WebSocket;

import { Buffer } from 'buffer';
import * as readline from 'readline';
import * as Rx from 'rxjs';

import {
  HDWallet,
  Roles,
  generateRandomSeed,
  WalletFacade,
  ShieldedWallet,
  DustWallet,
  UnshieldedWallet,
  createKeystore,
  PublicKey,
  NoOpTransactionHistoryStorage,
  DustAddress,
  MidnightBech32m,
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from '@midnightntwrk/wallet-sdk';
import type { UnshieldedKeystore } from '@midnightntwrk/wallet-sdk';
import { toHex } from '@midnight-ntwrk/midnight-js-utils';
import * as ledger from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { unshieldedToken } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { setNetworkId, getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';

// ─── Configuration ─────────────────────────────────────────────────────────────

const CONFIG = {
  networkId: 'preprod' as const,
  indexerHttpUrl: 'https://indexer.preprod.midnight.network/api/v4/graphql',
  indexerWsUrl: 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
  node: 'https://rpc.preprod.midnight.network',
  proofServer: 'http://localhost:6300',
  faucetUrl: 'https://midnight-tmnight-preprod.nethermind.dev/',
};

// ─── Helpers: Format raw balances to human-readable ────────────────────────────
// NIGHT is divided into 10^6 STAR. DUST is divided into 10^15 SPECK.

const formatNight = (raw: bigint): string => {
  const whole = raw / 1_000_000n;
  const fraction = (raw % 1_000_000n).toString().padStart(6, '0');
  return `${whole.toLocaleString()}.${fraction}`;
};

const formatDust = (raw: bigint): string => {
  const whole = raw / 1_000_000_000_000_000n;
  const fraction = (raw % 1_000_000_000_000_000n).toString().padStart(15, '0');
  return `${whole.toLocaleString()}.${fraction}`;
};

// ─── Helper: Clock Spinner ─────────────────────────────────────────────────────

const withStatus = async <T>(message: string, fn: () => Promise<T>): Promise<T> => {
  const clocks = ['🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙', '🕚', '🕛'];
  let i = 0;
  const interval = setInterval(() => {
    process.stdout.write(`\r  ${clocks[i++ % clocks.length]} ${message}`);
  }, 150);
  try {
    const result = await fn();
    clearInterval(interval);
    process.stdout.write(`\r  ✅ ${message}\n`);
    return result;
  } catch (e) {
    clearInterval(interval);
    process.stdout.write(`\r  ❌ ${message}\n`);
    throw e;
  }
};

// ─── Helper: Prompt for user input ─────────────────────────────────────────────

const prompt = (question: string): Promise<string> => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
};

// ─── Prompt for a valid Dust address ────────────────────────────────────────────

const isValidDustAddress = (addr: string): boolean => {
  if (!addr.startsWith('mn_dust_')) return false;
  try {
    MidnightBech32m.parse(addr).decode(DustAddress, getNetworkId());
    return true;
  } catch {
    return false;
  }
};

const promptForDustAddress = async (ownDustAddress: string): Promise<string> => {
  while (true) {
    const input = await prompt(`  Paste your Dust address to designate (Enter for this wallet's): `);
    const target = input || ownDustAddress;

    if (isValidDustAddress(target)) {
      if (target !== ownDustAddress) {
        console.log(`\n  Using external dust address: ${target}\n`);
      } else {
        console.log('');
      }
      return target;
    }

    console.log('  ❌ Invalid dust address. Dust addresses start with "mn_dust_" followed by the network.');
    console.log('     Make sure you\'re not pasting a shielded or unshielded address.\n');
  }
};

// ─── Create or Restore a Wallet Seed ───────────────────────────────────────────

const getOrCreateSeed = async (): Promise<string> => {
  const choice = await prompt('  Create a new wallet or restore an existing one? (n/r): ');
  if (choice.toLowerCase() === 'r') {
    const seed = await prompt('  Enter your seed: ');
    if (!seed || seed.length < 32) {
      throw new Error('Invalid seed. The seed should be a 64-character hex string.');
    }
    console.log('  Restoring wallet from seed...\n');
    return seed;
  }
  const seed = toHex(Buffer.from(generateRandomSeed()));
  console.log('\n  Created new wallet.');
  console.log('  ⚠️  Save this seed — it is the ONLY way to restore your wallet:\n');
  console.log(`  ${seed}\n`);
  return seed;
};

// ─── Derive Keys from the Seed ─────────────────────────────────────────────────

const deriveKeys = (seed: string) => {
  const hdWallet = HDWallet.fromSeed(Buffer.from(seed, 'hex'));
  if (hdWallet.type !== 'seedOk') {
    throw new Error('Failed to initialize HDWallet from seed. Is the seed a valid hex string?');
  }
  const derivationResult = hdWallet.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);
  if (derivationResult.type !== 'keysDerived') {
    throw new Error('Failed to derive keys from seed.');
  }
  hdWallet.hdWallet.clear();
  return derivationResult.keys;
};

// ─── Build the Wallet ──────────────────────────────────────────────────────────

const buildWallet = async (keys: ReturnType<typeof deriveKeys>) => {
  setNetworkId(CONFIG.networkId);
  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
  const unshieldedKeystore = createKeystore(keys[Roles.NightExternal], getNetworkId());
  const shieldedConfig = {
    networkId: getNetworkId(),
    indexerClientConnection: {
      indexerHttpUrl: CONFIG.indexerHttpUrl,
      indexerWsUrl: CONFIG.indexerWsUrl,
    },
    provingServerUrl: new URL(CONFIG.proofServer),
    relayURL: new URL(CONFIG.node.replace(/^http/, 'ws')),
  };
  const unshieldedConfig = {
    networkId: getNetworkId(),
    indexerClientConnection: {
      indexerHttpUrl: CONFIG.indexerHttpUrl,
      indexerWsUrl: CONFIG.indexerWsUrl,
    },
    txHistoryStorage: new NoOpTransactionHistoryStorage(),
  };
  const dustConfig = {
    ...shieldedConfig,
    costParameters: {
      additionalFeeOverhead: 300_000_000_000_000n,
      feeBlocksMargin: 5,
    },
  };
  const wallet = await WalletFacade.init({
    configuration: { ...shieldedConfig, ...unshieldedConfig, ...dustConfig },
    shielded: (cfg) => ShieldedWallet(cfg).startWithSecretKeys(shieldedSecretKeys),
    unshielded: (cfg) => UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
    dust: (cfg) =>
      DustWallet(cfg).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust),
  });
  await wallet.start(shieldedSecretKeys, dustSecretKey);
  return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
};

// ─── Wait for the Wallet to Sync ───────────────────────────────────────────────

const waitForSync = (wallet: WalletFacade) =>
  Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(5_000),
      Rx.filter((state) => state.isSynced),
    ),
  );

// ─── Wait for Incoming Funds ───────────────────────────────────────────────────

const waitForFunds = (wallet: WalletFacade): Promise<bigint> =>
  Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(10_000),
      Rx.filter((state) => state.isSynced),
      Rx.map((s) => s.unshielded.balances[unshieldedToken().raw] ?? 0n),
      Rx.filter((balance) => balance > 0n),
    ),
  );

// ─── Register NIGHT Tokens for DUST Generation ─────────────────────────────────

const registerForDustGeneration = async (
  wallet: WalletFacade,
  unshieldedKeystore: UnshieldedKeystore,
  targetDustAddress: string,
  isExternalAddress: boolean = false,
): Promise<void> => {
  const state = await Rx.firstValueFrom(
    wallet.state().pipe(Rx.filter((s) => s.isSynced)),
  );
  if (state.dust.availableCoins.length > 0) {
    const dustBalance = state.dust.balance(new Date());
    console.log(`  DUST already available: ${formatDust(dustBalance)}\n`);
    return;
  }
  const unregisteredCoins = state.unshielded.availableCoins.filter(
    (coin: any) => coin.meta?.registeredForDustGeneration !== true,
  );
  if (unregisteredCoins.length === 0) {
    console.log('  All NIGHT already registered. Waiting for DUST to generate...');
  } else {
    const dustReceiver = MidnightBech32m.parse(targetDustAddress).decode(DustAddress, getNetworkId());
    await withStatus(
      `Registering NIGHT for dust generation → ${targetDustAddress}`,
      async () => {
        const recipe = await wallet.registerNightUtxosForDustGeneration(
          unregisteredCoins,
          unshieldedKeystore.getPublicKey(),
          (payload) => unshieldedKeystore.signData(payload),
          dustReceiver,
        );
        const finalized = await wallet.finalizeRecipe(recipe);
        await wallet.submitTransaction(finalized);
      },
    );
  }
  if (!isExternalAddress) {
    await withStatus('Waiting for DUST to generate (this may take 1–2 minutes)', () =>
      Rx.firstValueFrom(
        wallet.state().pipe(
          Rx.throttleTime(5_000),
          Rx.filter((s) => s.isSynced),
          Rx.filter((s) => s.dust.balance(new Date()) > 0n),
        ),
      ),
    );
  }
};

// ─── Check DUST Balance ────────────────────────────────────────────────────────

const checkDustBalance = async (wallet: WalletFacade): Promise<bigint> => {
  const state = await Rx.firstValueFrom(
    wallet.state().pipe(Rx.filter((s) => s.isSynced)),
  );
  return state.dust.balance(new Date());
};

// ─── Main ──────────────────────────────────────────────────────────────────────

const main = async () => {
  console.log('');
  const seed = await getOrCreateSeed();
  const keys = deriveKeys(seed);
  const { wallet, unshieldedKeystore } = await withStatus('Building wallet', () => buildWallet(keys));

  const initialState = await Rx.firstValueFrom(wallet.state());
  const networkId = getNetworkId();

  const coinPubKey = ShieldedCoinPublicKey.fromHexString(initialState.shielded.coinPublicKey.toHexString());
  const encPubKey = ShieldedEncryptionPublicKey.fromHexString(initialState.shielded.encryptionPublicKey.toHexString());
  const shieldedAddress = MidnightBech32m.encode(networkId, new ShieldedAddress(coinPubKey, encPubKey)).toString();
  const unshieldedAddress = unshieldedKeystore.getBech32Address();
  const dustAddress = MidnightBech32m.encode(networkId, initialState.dust.address).toString();

  console.log('');
  console.log('  Wallet Addresses:');
  console.log(`    Shielded:    ${shieldedAddress}`);
  console.log(`    Unshielded:  ${unshieldedAddress}  ← send tNight here`);
  console.log(`    Dust:        ${dustAddress}`);
  console.log('');
  console.log(`  Faucet: ${CONFIG.faucetUrl}`);
  console.log('');

  await withStatus('Syncing wallet with network', () => waitForSync(wallet));

  const state = await Rx.firstValueFrom(wallet.state());
  const nightBalance = state.unshielded.balances[unshieldedToken().raw] ?? 0n;
  const dustBalance = state.dust.balance(new Date());

  let usedExternalAddress = false;

  if (nightBalance > 0n && dustBalance > 0n) {
    console.log(`  tNight Balance: ${formatNight(nightBalance)}`);
    console.log(`  DUST Balance:   ${formatDust(dustBalance)}\n`);
    console.log('  Your wallet is already generating DUST. No action needed.');
  } else if (nightBalance > 0n && dustBalance === 0n) {
    console.log(`  tNight Balance: ${formatNight(nightBalance)}`);
    console.log('  DUST Balance:   0\n');
    console.log('  You have tNight but no DUST yet. Let\'s register for DUST generation.\n');
    const targetDustAddress = await promptForDustAddress(dustAddress);
    usedExternalAddress = targetDustAddress !== dustAddress;
    await registerForDustGeneration(wallet, unshieldedKeystore, targetDustAddress, usedExternalAddress);
  } else {
    console.log('  Waiting for tNight — copy the unshielded address above and paste it into the faucet.');
    console.log('  ⚠️  Make sure you copy only the address with no extra spaces.\n');
    const balance = await withStatus('Waiting for incoming tNight', () => waitForFunds(wallet));
    console.log(`  tNight Balance: ${formatNight(balance)}\n`);
    const targetDustAddress = await promptForDustAddress(dustAddress);
    usedExternalAddress = targetDustAddress !== dustAddress;
    await registerForDustGeneration(wallet, unshieldedKeystore, targetDustAddress, usedExternalAddress);
  }

  if (usedExternalAddress) {
    console.log('');
    console.log('  DUST is being generated to the external address you designated.');
    console.log('  Because DUST is a shielded token, only the wallet holding that dust');
    console.log('  secret key can see the balance. Check the receiving wallet to verify');
    console.log('  DUST is accruing.');
  } else {
    const currentDust = await checkDustBalance(wallet);
    console.log('');
    console.log(`  DUST Balance: ${formatDust(currentDust)}`);
    console.log('  DUST generates continuously over time.');
    console.log('  Press Enter to re-check, or type "q" to quit.\n');
    let running = true;
    while (running) {
      const answer = await prompt('  > ');
      if (answer.toLowerCase() === 'q' || answer.toLowerCase() === 'quit' || answer.toLowerCase() === 'exit') {
        running = false;
      } else {
        const updated = await checkDustBalance(wallet);
        const time = new Date().toLocaleTimeString();
        console.log(`  [${time}] DUST Balance: ${formatDust(updated)}\n`);
      }
    }
  }

  console.log('');
  console.log('  To restore this wallet later, run the script again and choose "r".');
  console.log('');
  await wallet.stop();
  process.exit(0);
};

main().catch((err) => {
  console.error('\n  ❌ Error:', err.message || err);
  process.exit(1);
});
