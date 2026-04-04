import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PublicKey } from '@solana/web3.js';
import { previewIdlInstruction } from '../dist/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.env.APPPACK_RUNTIME_REGISTRY_PATH = path.resolve(
  __dirname,
  '../../ec-ai-wallet/public/idl/registry.json',
);

test('previewIdlInstruction normalizes defined enum args from SDK-style __kind shape', async () => {
  const preview = await previewIdlInstruction({
    protocolId: 'orca-whirlpool-mainnet',
    instructionName: 'increase_liquidity_by_token_amounts_v2',
    args: {
      method: {
        __kind: 'ByTokenAmounts',
        tokenMaxA: '10',
        tokenMaxB: '12',
        minSqrtPrice: '1',
        maxSqrtPrice: '2',
      },
      remaining_accounts_info: null,
    },
    accounts: {
      whirlpool: '2kJmUjxWBwL2NGPBV2PiA5hWtmLCqcKY6reQgkrPtaeS',
      token_program_a: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      token_program_b: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      memo_program: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
      position_authority: PublicKey.default.toBase58(),
      position: 'HFjd7yxKuDQyugfT565u9Kz9GmL7tEBystH5mLMfCWmL',
      position_token_account: '3Q4Qf6W4N9o4Czv7uLcw3ATpC1oDttxyPjdvVSdGJySL',
      token_mint_a: 'So11111111111111111111111111111111111111112',
      token_mint_b: '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo',
      token_owner_account_a: '9wFFmGphzaTWRmRmNE7pHBU8RLK2U71ha5vX4yxTXdwc',
      token_owner_account_b: 'GztkXy6E5qYH4Xh5Rkq4n6WsYom4tJmL14F5Se2YbK4h',
      token_vault_a: PublicKey.default.toBase58(),
      token_vault_b: PublicKey.default.toBase58(),
      tick_array_lower: 'GvqHLwv8B74NafR6UZYfzTnXY1FzMsnp9r1Weoq3DEud',
      tick_array_upper: 'GDzGiXe9GpYAMZu9VWuaoiqBP9yKhYATHm7AzECPx6Lx',
    },
    walletPublicKey: PublicKey.default,
  });

  const expectedHex =
    'effb097cd2c6352b000a000000000000000c00000000000000010000000000000000000000000000000200000000000000000000000000000000';
  assert.equal(Buffer.from(preview.dataBase64, 'base64').toString('hex'), expectedHex);
});
