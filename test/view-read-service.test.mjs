import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import BN from 'bn.js';
import { Connection, PublicKey } from '@solana/web3.js';
import { AppPackViewReadService } from '../dist/node/view-read-service.js';
import { DirectAccountsCoder } from '../dist/index.js';

const PROGRAM_ID = 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc';
const POOL_PUBKEY = 'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE';
const MINT_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const MINT_SOL = 'So11111111111111111111111111111111111111112';

const CODAMA = {
  kind: 'rootNode',
  standard: 'codama',
  version: '1.0.0',
  program: {
    publicKey: PROGRAM_ID,
    name: 'orca_whirlpool_test',
    version: '0.0.0',
    accounts: [
      {
        name: 'Whirlpool',
        data: {
          kind: 'structTypeNode',
          fields: [
            {
              name: 'discriminator',
              defaultValue: { encoding: 'base16', data: '3f95d10ce1806309' },
            },
            { name: 'token_mint_a', type: { kind: 'publicKeyTypeNode' } },
            { name: 'token_mint_b', type: { kind: 'publicKeyTypeNode' } },
            { name: 'tick_spacing', type: { kind: 'numberTypeNode', format: 'u16' } },
            { name: 'liquidity', type: { kind: 'numberTypeNode', format: 'u128' } },
          ],
        },
      },
    ],
    instructions: [],
    definedTypes: [],
  },
};

const RUNTIME = {
  schema: 'solana-agent-runtime.v1',
  version: '0.1.0',
  protocol: {
    protocolId: 'orca-whirlpool-mainnet',
    label: 'Orca Whirlpool Test Runtime',
    programId: PROGRAM_ID,
    codamaPath: '/idl/orca_whirlpool.codama.json',
  },
  navigation: {
    entities: {},
    entrypoints: {},
    relations: [],
    recipes: {},
  },
  reads: {
    contract: {
      whirlpool_snapshot: {
        inputs: {
          pool: { type: 'pubkey', required: true },
        },
        read: {
          kind: 'account',
          target: {
            address: '$input.pool',
            account_type: 'Whirlpool',
          },
          select: {
            pool: '$account.pubkey',
            tokenMintA: '$decoded.token_mint_a',
            tokenMintB: '$decoded.token_mint_b',
            tickSpacing: '$decoded.tick_spacing',
            liquidity: '$decoded.liquidity',
          },
        },
      },
    },
    index: {},
  },
  computes: {},
  executions: {},
};

async function writeTempRuntimeWithCodama(prefix, runtimeValue, codamaValue) {
  const dir = path.join(os.tmpdir(), `apppack-runtime-test-${randomUUID()}`);
  const idlDir = path.join(dir, 'idl');
  await fs.mkdir(idlDir, { recursive: true });
  const runtimePath = path.join(idlDir, `${prefix}.runtime.json`);
  const codamaPath = path.join(idlDir, 'orca_whirlpool.codama.json');
  await fs.writeFile(runtimePath, JSON.stringify(runtimeValue, null, 2), 'utf8');
  await fs.writeFile(codamaPath, JSON.stringify(codamaValue, null, 2), 'utf8');
  return runtimePath;
}

test('runRead resolves a targeted contract read from cached_program_accounts', async () => {
  const runtimePath = await writeTempRuntimeWithCodama('runtime', RUNTIME, CODAMA);
  const coder = new DirectAccountsCoder(CODAMA);

  const data = await coder.encode('Whirlpool', {
    token_mint_a: new PublicKey(MINT_USDC),
    token_mint_b: new PublicKey(MINT_SOL),
    tick_spacing: 4,
    liquidity: new BN('1000000'),
  });

  const pool = {
    async query(sql) {
      if (String(sql).includes('FROM cached_program_accounts')) {
        return {
          rows: [
            {
              pubkey: POOL_PUBKEY,
              slot: '202532154',
              first_seen_slot: '202532000',
              last_seen_slot: '202532154',
              data_bytes: Buffer.from(data),
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    },
    async end() {},
  };

  const service = new AppPackViewReadService({
    connection: new Connection('http://127.0.0.1:8899', 'confirmed'),
    databaseUrl: null,
    poolOverride: pool,
    cacheTtlMs: 1000,
    protocolId: 'orca-whirlpool-mainnet',
    runtimePath,
    programId: PROGRAM_ID,
    operationId: 'whirlpool_snapshot',
  });

  const result = await service.runRead({
    input: { pool: POOL_PUBKEY },
    limit: 1,
  });

  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0], {
    pool: POOL_PUBKEY,
    tokenMintA: MINT_USDC,
    tokenMintB: MINT_SOL,
    tickSpacing: '4',
    liquidity: '1000000',
  });

  await service.close();
});

test('runRead falls back to RPC account fetch for targeted contract reads', async () => {
  const runtimePath = await writeTempRuntimeWithCodama('runtime-rpc', RUNTIME, CODAMA);
  const coder = new DirectAccountsCoder(CODAMA);

  const data = await coder.encode('Whirlpool', {
    token_mint_a: new PublicKey(MINT_USDC),
    token_mint_b: new PublicKey(MINT_SOL),
    tick_spacing: 16,
    liquidity: new BN('2000000'),
  });

  const connection = {
    async getAccountInfo(pubkey) {
      assert.equal(pubkey.toBase58(), POOL_PUBKEY);
      return {
        data: Buffer.from(data),
        executable: false,
        lamports: 1,
        owner: new PublicKey(PROGRAM_ID),
        rentEpoch: BigInt(0),
      };
    },
  };

  const service = new AppPackViewReadService({
    connection: connection,
    databaseUrl: null,
    cacheTtlMs: 1000,
    protocolId: 'orca-whirlpool-mainnet',
    runtimePath,
    programId: PROGRAM_ID,
    operationId: 'whirlpool_snapshot',
  });

  const result = await service.runRead({
    input: { pool: POOL_PUBKEY },
    limit: 1,
  });

  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0], {
    pool: POOL_PUBKEY,
    tokenMintA: MINT_USDC,
    tokenMintB: MINT_SOL,
    tickSpacing: '16',
    liquidity: '2000000',
  });
});
