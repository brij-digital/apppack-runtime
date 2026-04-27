import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const PROGRAM_ID = '11111111111111111111111111111111';
const OWNER = '4x4K45kncfjpoPgWBaFU4x1iDMsfGBfPwrFNJzXUgGcR';
const ADDRESS_A = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const ADDRESS_B = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

function writeFixture() {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apppack-runtime-account-infos-'));
  const registryPath = path.join(fixtureDir, 'registry.json');
  const idlDir = path.join(fixtureDir, 'idl');
  const codamaPath = path.join(idlDir, 'spec.codama.json');
  const runtimePath = path.join(idlDir, 'spec.runtime.json');
  fs.mkdirSync(idlDir, { recursive: true });

  fs.writeFileSync(
    registryPath,
    JSON.stringify({
      version: 'test',
      protocols: [
        {
          id: 'spec-runtime-mainnet',
          name: 'Spec Runtime',
          network: 'mainnet',
          programId: PROGRAM_ID,
          codamaIdlPath: '/idl/spec.codama.json',
          agentRuntimePath: '/idl/spec.runtime.json',
          transport: 'solana-rpc',
          supportedCommands: [],
          status: 'active',
        },
      ],
    }),
  );
  fs.writeFileSync(
    codamaPath,
    JSON.stringify({
      program: {
        name: 'SpecRuntime',
        pdas: [],
        instructions: [],
        accounts: [],
        definedTypes: [],
      },
    }),
  );
  fs.writeFileSync(
    runtimePath,
    JSON.stringify({
      schema: 'solana-agent-runtime.v1',
      protocol_id: 'spec-runtime-mainnet',
      program_id: PROGRAM_ID,
      codama_path: '/idl/spec.codama.json',
      views: {
        account_snapshot: {
          inputs: {
            addresses: 'json',
          },
          steps: [
            {
              name: 'account_infos',
              kind: 'account_infos',
              addresses: '$input.addresses',
            },
          ],
          output: {
            type: 'array',
            source: '$account_infos',
          },
        },
      },
      writes: {},
      transforms: {},
    }),
  );

  return { registryPath };
}

function runWithRegistry(registryPath, body) {
  const script = `
    process.env.APPPACK_RUNTIME_REGISTRY_PATH = ${JSON.stringify(registryPath)};
    ${body}
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `child process failed with code ${result.status}`);
  }
  return JSON.parse(result.stdout);
}

test('account_infos view returns existence and owner metadata without failing on missing accounts', () => {
  const { registryPath } = writeFixture();
  const output = runWithRegistry(
    registryPath,
    `
      const { PublicKey } = await import('@solana/web3.js');
      const runtime = await import(${JSON.stringify(path.resolve('dist/runtimeOperationRuntime.js'))});

      const connection = {
        async getAccountInfo(address) {
          const value = address.toBase58();
          if (value === ${JSON.stringify(ADDRESS_A)}) {
            return {
              owner: new PublicKey(${JSON.stringify(TOKEN_PROGRAM)}),
              lamports: 123n,
              executable: false,
              data: Buffer.alloc(165)
            };
          }
          return null;
        }
      };

      const result = await runtime.runRuntimeView({
        protocolId: 'spec-runtime-mainnet',
        operationId: 'account_snapshot',
        input: { addresses: [${JSON.stringify(ADDRESS_A)}, ${JSON.stringify(ADDRESS_B)}] },
        connection,
        walletPublicKey: new PublicKey(${JSON.stringify(OWNER)})
      });

      console.log(JSON.stringify(result.output));
    `,
  );

  assert.deepEqual(output, [
    {
      address: ADDRESS_A,
      exists: true,
      owner: TOKEN_PROGRAM,
      lamports: '123',
      executable: false,
      dataLength: 165,
    },
    {
      address: ADDRESS_B,
      exists: false,
      owner: null,
      lamports: null,
      executable: null,
      dataLength: null,
    },
  ]);
});
