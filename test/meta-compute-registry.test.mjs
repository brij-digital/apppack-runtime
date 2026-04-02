import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey } from '@solana/web3.js';
import { runRegisteredComputeStep } from '../dist/metaComputeRegistry.js';

const BASE_CTX = {
  protocolId: 'pump-core-mainnet',
  programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  connection: {},
  walletPublicKey: new PublicKey('11111111111111111111111111111111'),
  idl: {},
  scope: {},
  previewInstruction: async () => {
    throw new Error('previewInstruction should not be called in meta compute tests');
  },
};

test('meta compute accepts bare hex strings from decoded accounts', async () => {
  const result = await runRegisteredComputeStep(
    {
      name: 'sum_hex_values',
      kind: 'math.add',
      values: ['03cfdaf40e3b4c', '06fc32ee54'],
    },
    BASE_CTX,
  );

  assert.equal(result, (BigInt('0x03cfdaf40e3b4c') + BigInt('0x06fc32ee54')).toString());
});

test('meta compute supports min/max and mul_div floor/ceil helpers', async () => {
  const min = await runRegisteredComputeStep(
    {
      name: 'min_value',
      kind: 'math.min',
      values: ['900', '1000', '836'],
    },
    BASE_CTX,
  );
  const max = await runRegisteredComputeStep(
    {
      name: 'max_value',
      kind: 'math.max',
      values: ['900', '1000', '836'],
    },
    BASE_CTX,
  );
  const mulDivFloor = await runRegisteredComputeStep(
    {
      name: 'mul_div_floor',
      kind: 'math.mul_div_floor',
      multiplicand: '929',
      multiplier: '9900',
      divisor: '10000',
    },
    BASE_CTX,
  );
  const mulDivCeil = await runRegisteredComputeStep(
    {
      name: 'mul_div_ceil',
      kind: 'math.mul_div_ceil',
      multiplicand: '929',
      multiplier: '9900',
      divisor: '10000',
    },
    BASE_CTX,
  );

  assert.equal(min, '836');
  assert.equal(max, '1000');
  assert.equal(mulDivFloor, '919');
  assert.equal(mulDivCeil, '920');
});

test('meta compute supports modular and bitwise helpers', async () => {
  const mod = await runRegisteredComputeStep(
    {
      name: 'tick_mod_spacing',
      kind: 'math.mod',
      dividend: '-5',
      divisor: '2',
    },
    BASE_CTX,
  );
  const shiftLeft = await runRegisteredComputeStep(
    {
      name: 'q64_one',
      kind: 'math.shift_left',
      value: '1',
      shift: 64,
    },
    BASE_CTX,
  );
  const shiftRight = await runRegisteredComputeStep(
    {
      name: 'restore_integer',
      kind: 'math.shift_right',
      value: '340282366920938463463374607431768211456',
      shift: 64,
    },
    BASE_CTX,
  );
  const bitAnd = await runRegisteredComputeStep(
    {
      name: 'tick_mask',
      kind: 'math.bit_and',
      left: '13',
      right: '6',
    },
    BASE_CTX,
  );

  assert.equal(mod, '-1');
  assert.equal(shiftLeft, '18446744073709551616');
  assert.equal(shiftRight, '18446744073709551616');
  assert.equal(bitAnd, '4');
});

test('meta compute supports list sorting and first-match lookup', async () => {
  const items = [
    { start_tick_index: 5632, initialized: false },
    { start_tick_index: 0, initialized: true },
    { start_tick_index: 11264, initialized: true },
  ];
  const sorted = await runRegisteredComputeStep(
    {
      name: 'sorted_ticks',
      kind: 'list.sort_by',
      items,
      path: 'start_tick_index',
      order: 'asc',
    },
    BASE_CTX,
  );
  const firstInitialized = await runRegisteredComputeStep(
    {
      name: 'first_initialized',
      kind: 'list.find_first',
      items: sorted,
      where: { path: 'initialized', value: true },
    },
    BASE_CTX,
  );

  assert.deepEqual(
    sorted.map((entry) => entry.start_tick_index),
    [0, 5632, 11264],
  );
  assert.deepEqual(firstInitialized, { start_tick_index: 0, initialized: true });
});

test('meta compute supports concatenating lists', async () => {
  const concatenated = await runRegisteredComputeStep(
    {
      name: 'swap_targets',
      kind: 'list.concat',
      lists: [
        [
          { tick_index: '2', initialized: true },
          { tick_index: '4', initialized: true },
        ],
        [
          { tick_index: '527', initialized: false, terminal: true },
        ],
      ],
    },
    BASE_CTX,
  );

  assert.deepEqual(concatenated, [
    { tick_index: '2', initialized: true },
    { tick_index: '4', initialized: true },
    { tick_index: '527', initialized: false, terminal: true },
  ]);
});

test('meta compute supports object creation and shallow merge', async () => {
  const created = await runRegisteredComputeStep(
    {
      name: 'quote_fields',
      kind: 'object.create',
      fields: {
        whirlpool: 'pool-1',
        estimated_out: '929',
      },
    },
    BASE_CTX,
  );
  const merged = await runRegisteredComputeStep(
    {
      name: 'quote_payload',
      kind: 'object.merge',
      objects: [
        created,
        null,
        {
          minimum_out: '836',
          estimated_out: '930',
        },
      ],
    },
    BASE_CTX,
  );

  assert.deepEqual(created, {
    whirlpool: 'pool-1',
    estimated_out: '929',
  });
  assert.deepEqual(merged, {
    whirlpool: 'pool-1',
    estimated_out: '930',
    minimum_out: '836',
  });
});
