import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey } from '@solana/web3.js';
import { getInstructionTemplate, previewIdlInstruction } from '../dist/index.js';

const PROGRAM_ID = 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc';
const MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const WHIRLPOOL = 'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE';
const WALLET = '4x4K45kncfjpoPgWBaFU4x1iDMsfGBfPwrFNJzXUgGcR';
const ATA_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const MINT = 'So11111111111111111111111111111111111111112';

const REGISTRY = {
  version: 'test',
  protocols: [
    {
      id: 'codama-defaults-test',
      name: 'Codama Defaults Test',
      network: 'mainnet',
      programId: PROGRAM_ID,
      codamaIdlPath: '/idl/codama-defaults-test.codama.json',
      transport: 'solana-rpc',
      supportedCommands: [],
      status: 'active',
    },
    {
      id: 'codama-ata-test',
      name: 'Codama ATA Test',
      network: 'mainnet',
      programId: PROGRAM_ID,
      codamaIdlPath: '/idl/codama-ata-test.codama.json',
      transport: 'solana-rpc',
      supportedCommands: [],
      status: 'active',
    },
  ],
};

const CODAMA = {
  program: {
    pdas: [
      {
        name: 'oracle',
        seeds: [
          {
            kind: 'constantPdaSeedNode',
            value: {
              kind: 'bytesValueNode',
              encoding: 'base16',
              data: '6f7261636c65',
            },
          },
          {
            kind: 'variablePdaSeedNode',
            name: 'whirlpool',
          },
        ],
      },
    ],
    instructions: [
      {
        name: 'swapV2',
        arguments: [
          {
            name: 'discriminator',
            type: { kind: 'bytesTypeNode' },
            defaultValue: {
              encoding: 'base16',
              data: '0102030405060708',
            },
          },
          {
            name: 'amount',
            type: {
              kind: 'numberTypeNode',
              format: 'u64',
            },
          },
        ],
        accounts: [
          {
            kind: 'instructionAccountNode',
            name: 'authority',
            isWritable: false,
            isSigner: true,
            isOptional: false,
          },
          {
            kind: 'instructionAccountNode',
            name: 'whirlpool',
            isWritable: true,
            isSigner: false,
            isOptional: false,
          },
          {
            kind: 'instructionAccountNode',
            name: 'oracle',
            isWritable: true,
            isSigner: false,
            isOptional: false,
            defaultValue: {
              kind: 'pdaValueNode',
              pda: {
                kind: 'pdaLinkNode',
                name: 'oracle',
              },
              seeds: [
                {
                  kind: 'pdaSeedValueNode',
                  name: 'whirlpool',
                  value: {
                    kind: 'accountValueNode',
                    name: 'whirlpool',
                  },
                },
              ],
            },
          },
          {
            kind: 'instructionAccountNode',
            name: 'memoProgram',
            isWritable: false,
            isSigner: false,
            isOptional: false,
            defaultValue: {
              kind: 'publicKeyValueNode',
              publicKey: MEMO_PROGRAM_ID,
            },
          },
        ],
      },
    ],
    accounts: [],
    definedTypes: [],
  },
};

const CODAMA_ATA = {
  program: {
    pdas: [
      {
        name: 'tokenOwnerAccountA',
        programId: ATA_PROGRAM_ID,
        seeds: [
          {
            kind: 'variablePdaSeedNode',
            name: 'tokenAuthority',
            type: { kind: 'publicKeyTypeNode' },
          },
          {
            kind: 'constantPdaSeedNode',
            type: { kind: 'publicKeyTypeNode' },
            value: { kind: 'publicKeyValueNode', publicKey: TOKEN_PROGRAM_ID },
          },
          {
            kind: 'variablePdaSeedNode',
            name: 'tokenMintA',
            type: { kind: 'publicKeyTypeNode' },
          },
        ],
      },
    ],
    instructions: [
      {
        name: 'swapV2',
        arguments: [
          {
            name: 'discriminator',
            type: { kind: 'bytesTypeNode' },
            defaultValue: { encoding: 'base16', data: '0102030405060708' },
          },
        ],
        accounts: [
          {
            kind: 'instructionAccountNode',
            name: 'tokenAuthority',
            isWritable: false,
            isSigner: true,
            isOptional: false,
            docs: [],
          },
          {
            kind: 'instructionAccountNode',
            name: 'tokenMintA',
            isWritable: false,
            isSigner: false,
            isOptional: false,
            docs: [],
          },
          {
            kind: 'instructionAccountNode',
            name: 'tokenOwnerAccountA',
            isWritable: true,
            isSigner: false,
            isOptional: false,
            docs: [],
            defaultValue: {
              kind: 'pdaValueNode',
              pda: { kind: 'pdaLinkNode', name: 'tokenOwnerAccountA' },
              seeds: [],
            },
          },
        ],
        docs: [],
      },
    ],
    accounts: [],
    definedTypes: [],
  },
};

test('Codama default accounts drive templates and preview account metas', async () => {
  const originalFetch = globalThis.fetch;
  const originalBase = process.env.APPPACK_RUNTIME_BASE_URL;
  process.env.APPPACK_RUNTIME_BASE_URL = 'http://runner.test';

  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes('/idl/registry.json')) {
      return new Response(JSON.stringify(REGISTRY), { status: 200 });
    }
    if (target.includes('/idl/codama-defaults-test.codama.json')) {
      return new Response(JSON.stringify(CODAMA), { status: 200 });
    }
    if (target.includes('/idl/codama-ata-test.codama.json')) {
      return new Response(JSON.stringify(CODAMA_ATA), { status: 200 });
    }
    throw new Error(`Unexpected fetch ${target}`);
  };

  try {
    const template = await getInstructionTemplate({
      protocolId: 'codama-defaults-test',
      instructionName: 'swap_v2',
    });

    assert.equal(template.accounts.authority, '$WALLET');
    assert.equal(template.accounts.whirlpool, '<PUBKEY>');
    assert.equal(template.accounts.memo_program, MEMO_PROGRAM_ID);
    assert.equal(template.accounts.oracle, '<AUTO_PDA:oracle>');

    const preview = await previewIdlInstruction({
      protocolId: 'codama-defaults-test',
      instructionName: 'swap_v2',
      args: {
        amount: '1',
      },
      accounts: {
        whirlpool: WHIRLPOOL,
      },
      walletPublicKey: new PublicKey(WALLET),
    });

    const expectedOracle = PublicKey.findProgramAddressSync(
      [Buffer.from('oracle'), new PublicKey(WHIRLPOOL).toBuffer()],
      new PublicKey(PROGRAM_ID),
    )[0].toBase58();

    assert.equal(preview.keys[0].pubkey, WALLET);
    assert.equal(preview.keys[1].pubkey, WHIRLPOOL);
    assert.equal(preview.keys[2].pubkey, expectedOracle);
    assert.equal(preview.keys[3].pubkey, MEMO_PROGRAM_ID);
    assert.equal(preview.resolvedAccounts.memo_program, MEMO_PROGRAM_ID);
    assert.equal(preview.resolvedAccounts.oracle, expectedOracle);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBase === undefined) {
      delete process.env.APPPACK_RUNTIME_BASE_URL;
    } else {
      process.env.APPPACK_RUNTIME_BASE_URL = originalBase;
    }
  }
});

test('Codama PDA defaults honor custom PDA program ids for ATA-like accounts', async () => {
  const originalFetch = globalThis.fetch;
  const originalBase = process.env.APPPACK_RUNTIME_BASE_URL;
  process.env.APPPACK_RUNTIME_BASE_URL = 'http://runner.test';

  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes('/idl/registry.json')) {
      return new Response(JSON.stringify(REGISTRY), { status: 200 });
    }
    if (target.includes('/idl/codama-ata-test.codama.json')) {
      return new Response(JSON.stringify(CODAMA_ATA), { status: 200 });
    }
    throw new Error(`Unexpected fetch ${target}`);
  };

  try {
    const preview = await previewIdlInstruction({
      protocolId: 'codama-ata-test',
      instructionName: 'swap_v2',
      args: {},
      accounts: {
        token_mint_a: MINT,
      },
      walletPublicKey: new PublicKey(WALLET),
    });

    const expectedAta = PublicKey.findProgramAddressSync(
      [new PublicKey(WALLET).toBuffer(), new PublicKey(TOKEN_PROGRAM_ID).toBuffer(), new PublicKey(MINT).toBuffer()],
      new PublicKey(ATA_PROGRAM_ID),
    )[0].toBase58();

    assert.equal(preview.resolvedAccounts.token_owner_account_a, expectedAta);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBase === undefined) {
      delete process.env.APPPACK_RUNTIME_BASE_URL;
    } else {
      process.env.APPPACK_RUNTIME_BASE_URL = originalBase;
    }
  }
});
