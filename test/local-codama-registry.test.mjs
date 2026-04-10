import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('Codama loader reads local filesystem packs when APPPACK_RUNTIME_REGISTRY_PATH is set', () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apppack-runtime-local-codama-'));
  const registryPath = path.join(fixtureDir, 'registry.json');
  const codamaPath = path.join(fixtureDir, 'orca.codama.json');

  fs.writeFileSync(
    registryPath,
    JSON.stringify({
      version: 'test',
      protocols: [
        {
          id: 'orca-whirlpool-mainnet',
          name: 'Orca Whirlpool',
          network: 'mainnet',
          programId: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
          codamaIdlPath: '/idl/orca.codama.json',
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
      codama: {
        program: {
          name: 'OrcaWhirlpool',
          instructions: [],
          accounts: [],
          definedTypes: [],
          pdas: [],
        },
      },
    }),
  );

  const script = `
    process.env.APPPACK_RUNTIME_REGISTRY_PATH = ${JSON.stringify(registryPath)};
    const { loadProtocolCodamaDocument } = await import(${JSON.stringify(path.resolve('dist/protocolLoader.js'))});
    const doc = await loadProtocolCodamaDocument('orca-whirlpool-mainnet');
    console.log(JSON.stringify(doc));
  `;

  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `child process failed with code ${result.status}`);
  }

  assert.match(result.stdout, /"OrcaWhirlpool"/);
});
