import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('runtime views support scoped list map/flat_map/reduce transforms', () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apppack-runtime-scoped-transform-'));
  const registryPath = path.join(fixtureDir, 'registry.json');
  const codamaPath = path.join(fixtureDir, 'test.codama.json');
  const runtimePath = path.join(fixtureDir, 'test.runtime.json');

  fs.writeFileSync(
    registryPath,
    JSON.stringify({
      version: 'test',
      protocols: [
        {
          id: 'test-runtime-mainnet',
          name: 'Test Runtime',
          network: 'mainnet',
          programId: '11111111111111111111111111111111',
          codamaIdlPath: '/idl/test.codama.json',
          agentRuntimePath: '/idl/test.runtime.json',
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
          name: 'TestRuntime',
          instructions: [],
          accounts: [],
          definedTypes: [],
          pdas: [],
        },
      },
    }),
  );

  fs.writeFileSync(
    runtimePath,
    JSON.stringify({
      schema: 'solana-agent-runtime.v1',
      protocol_id: 'test-runtime-mainnet',
      program_id: '11111111111111111111111111111111',
      codama_path: '/idl/test.codama.json',
      views: {
        scoped_transform_demo: {
          inputs: {
            groups: 'json',
          },
          steps: [
            {
              kind: 'transform',
              transform: 'demo',
            },
          ],
          output: {
            type: 'object',
            source: '$derived.payload',
            object_schema: {
              fields: {
                groups: { type: 'json' },
                flattened: { type: 'json' },
                sum: { type: 'u64' },
              },
            },
          },
        },
      },
      writes: {},
      transforms: {
        demo: [
          {
            name: 'groups',
            kind: 'list.map',
            items: '$input.groups',
            item_as: 'group',
            steps: [
              {
                name: 'group_summary',
                kind: 'object.create',
                fields: {
                  name: '$group.name',
                  values: '$group.values',
                },
              },
            ],
            output: '$group_summary',
          },
          {
            name: 'flattened',
            kind: 'list.flat_map',
            items: '$groups',
            item_as: 'group',
            output: '$group.values',
          },
          {
            name: 'sum',
            kind: 'list.reduce',
            items: '$flattened',
            initial: '0',
            item_as: 'value',
            acc_as: 'acc',
            steps: [
              {
                name: 'next_total',
                kind: 'math.add',
                values: ['$acc', '$value'],
              },
            ],
            output: '$next_total',
          },
          {
            name: 'payload',
            kind: 'object.create',
            fields: {
              groups: '$groups',
              flattened: '$flattened',
              sum: '$sum',
            },
          },
        ],
      },
    }),
  );

  const script = `
    process.env.APPPACK_RUNTIME_REGISTRY_PATH = ${JSON.stringify(registryPath)};
    const { PublicKey } = await import('@solana/web3.js');
    const { runRuntimeView } = await import(${JSON.stringify(path.resolve('dist/runtimeOperationRuntime.js'))});
    const view = await runRuntimeView({
      protocolId: 'test-runtime-mainnet',
      operationId: 'scoped_transform_demo',
      input: {
        groups: [
          { name: 'alpha', values: [1, 2] },
          { name: 'beta', values: [3, 4] }
        ]
      },
      connection: {},
      walletPublicKey: new PublicKey('11111111111111111111111111111111'),
    });
    console.log(JSON.stringify(view.output));
  `;

  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `child process failed with code ${result.status}`);
  }

  assert.deepEqual(JSON.parse(result.stdout), {
    groups: [
      { name: 'alpha', values: [1, 2] },
      { name: 'beta', values: [3, 4] },
    ],
    flattened: [1, 2, 3, 4],
    sum: '10',
  });
});

test('runtime views support nested named transforms inside scoped collection transforms', () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apppack-runtime-nested-transform-'));
  const registryPath = path.join(fixtureDir, 'registry.json');
  const codamaPath = path.join(fixtureDir, 'test.codama.json');
  const runtimePath = path.join(fixtureDir, 'test.runtime.json');

  fs.writeFileSync(
    registryPath,
    JSON.stringify({
      version: 'test',
      protocols: [
        {
          id: 'test-runtime-mainnet',
          name: 'Test Runtime',
          network: 'mainnet',
          programId: '11111111111111111111111111111111',
          codamaIdlPath: '/idl/test.codama.json',
          agentRuntimePath: '/idl/test.runtime.json',
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
          name: 'TestRuntime',
          instructions: [],
          accounts: [],
          definedTypes: [],
          pdas: [],
        },
      },
    }),
  );

  fs.writeFileSync(
    runtimePath,
    JSON.stringify({
      schema: 'solana-agent-runtime.v1',
      protocol_id: 'test-runtime-mainnet',
      program_id: '11111111111111111111111111111111',
      codama_path: '/idl/test.codama.json',
      views: {
        nested_transform_demo: {
          inputs: {
            values: 'json',
            multiplier: 'u64',
          },
          steps: [
            {
              kind: 'transform',
              transform: 'demo',
            },
          ],
          output: {
            type: 'array',
            source: '$derived.mapped',
            item_schema: {
              fields: {
                original: { type: 'u64' },
                scaled: { type: 'u64' },
                ordinal: { type: 'u64' },
              },
            },
          },
        },
      },
      writes: {},
      transforms: {
        scale: [
          {
            name: 'scaled',
            kind: 'math.mul',
            values: ['$value', '$multiplier'],
          },
          {
            name: 'payload',
            kind: 'object.create',
            fields: {
              original: '$value',
              scaled: '$scaled',
              ordinal: '$ordinal',
            },
          },
        ],
        demo: [
          {
            name: 'mapped',
            kind: 'list.map',
            items: '$input.values',
            item_as: 'value',
            index_as: 'index',
            steps: [
              {
                name: 'scale_result',
                kind: 'transform',
                transform: 'scale',
                bindings: {
                  value: '$value',
                  multiplier: '$input.multiplier',
                  ordinal: '$index',
                },
                output: '$payload',
              },
            ],
            output: '$scale_result',
          },
        ],
      },
    }),
  );

  const script = `
    process.env.APPPACK_RUNTIME_REGISTRY_PATH = ${JSON.stringify(registryPath)};
    const { PublicKey } = await import('@solana/web3.js');
    const { runRuntimeView } = await import(${JSON.stringify(path.resolve('dist/runtimeOperationRuntime.js'))});
    const view = await runRuntimeView({
      protocolId: 'test-runtime-mainnet',
      operationId: 'nested_transform_demo',
      input: {
        values: [2, 3, 5],
        multiplier: '7',
      },
      connection: {},
      walletPublicKey: new PublicKey('11111111111111111111111111111111'),
    });
    console.log(JSON.stringify(view.output));
  `;

  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `child process failed with code ${result.status}`);
  }

  assert.deepEqual(JSON.parse(result.stdout), [
    { original: 2, scaled: '14', ordinal: 0 },
    { original: 3, scaled: '21', ordinal: 1 },
    { original: 5, scaled: '35', ordinal: 2 },
  ]);
});
