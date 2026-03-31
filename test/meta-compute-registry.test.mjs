import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey } from '@solana/web3.js';
import { runRegisteredComputeStep } from '../dist/metaComputeRegistry.js';

test('meta compute accepts bare hex strings from decoded accounts', async () => {
  const result = await runRegisteredComputeStep(
    {
      name: 'sum_hex_values',
      kind: 'math.add',
      values: ['03cfdaf40e3b4c', '06fc32ee54'],
    },
    {
      protocolId: 'pump-core-mainnet',
      programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
      connection: {},
      walletPublicKey: new PublicKey('11111111111111111111111111111111'),
      idl: {},
      scope: {},
      previewInstruction: async () => {
        throw new Error('previewInstruction should not be called in math.add test');
      },
    },
  );

  assert.equal(result, (BigInt('0x03cfdaf40e3b4c') + BigInt('0x06fc32ee54')).toString());
});
