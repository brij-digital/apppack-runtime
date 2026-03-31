import fs from 'node:fs';
import path from 'node:path';
import { Connection, PublicKey } from '@solana/web3.js';
import type { CodamaDocument } from '../codamaIdl.js';
import { DirectAccountsCoder } from '../directAccountsCoder.js';
import { Pool } from 'pg';

type OperationInputDef = {
  type: string;
  required?: boolean;
  default?: unknown;
};

type AccountViewDef = {
  kind: 'account';
  source?: 'rpc' | 'indexed' | 'hybrid';
  entity_type?: string;
  target: {
    address: unknown;
    account_type: string;
  };
  select: Record<string, unknown>;
  title?: string;
  description?: string;
};

type ReadOperationDef = {
  inputs?: Record<string, OperationInputDef>;
  read: AccountViewDef;
};

type MetaPack = {
  protocol: {
    protocolId: string;
    codamaPath: string;
  };
  reads?: {
    contract?: Record<string, ReadOperationDef>;
  };
};

type RunReadOptions = {
  input: Record<string, unknown>;
  limit: number;
};

type ReadResult = {
  items: Record<string, unknown>[];
  source: 'cache' | 'db';
  slot: number;
  generatedAtMs: number;
};

type FullSyncResult = {
  totalAccounts: number;
  upserted: number;
  slot: number;
};

type IncrementalSyncResult = {
  inputAccounts: number;
  fetchedAccounts: number;
  decodedAccounts: number;
  upserted: number;
  slot: number;
};

type AppPackViewReadServiceOptions = {
  connection: Connection;
  databaseUrl: string | null;
  poolOverride?: Pool | null;
  cacheTtlMs: number;
  runtimePath: string;
  programId: string;
  protocolId: string;
  operationId: string;
};

type DecodedAccountContext = {
  account: {
    pubkey: string;
    slot?: number;
    firstSeenSlot?: number;
    lastSeenSlot?: number;
  };
  decoded: Record<string, unknown>;
  input: Record<string, unknown>;
  protocol: {
    programId: string;
  };
};

type CompiledOperation = {
  protocolId: string;
  namespace: string;
  programId: PublicKey;
  accountType: string;
  accountSize: number;
  operationInputDefs: Record<string, OperationInputDef>;
  select: Record<string, unknown>;
  targetAddress: unknown;
};

const ACCOUNT_CACHE_TABLE = 'cached_program_accounts';

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseOperationPack(runtimePath: string): MetaPack {
  return JSON.parse(fs.readFileSync(runtimePath, 'utf8')) as MetaPack;
}

function parseRuntimeCodamaDocument(runtimePath: string, protocolId: string): CodamaDocument {
  const runtime = parseOperationPack(runtimePath);
  const codamaPath = typeof runtime.protocol?.codamaPath === 'string' ? runtime.protocol.codamaPath : null;
  if (!codamaPath || !codamaPath.startsWith('/idl/')) {
    throw new Error(`runtime ${runtimePath} is missing a valid protocol.codamaPath for ${protocolId}.`);
  }
  const codamaFilePath = path.join(path.dirname(runtimePath), codamaPath.slice('/idl/'.length));
  return JSON.parse(fs.readFileSync(codamaFilePath, 'utf8')) as CodamaDocument;
}

function parsePublicKey(value: string, name: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new Error(`${name} must be a valid public key.`);
  }
}

function readByPath(root: unknown, dotPath: string): unknown {
  if (!dotPath) {
    return root;
  }
  const parts = dotPath.split('.');
  let current: unknown = root;
  for (const part of parts) {
    if (!part) {
      continue;
    }
    if (!isObjectRecord(current) && !Array.isArray(current)) {
      return undefined;
    }
    if (Array.isArray(current)) {
      const index = Number.parseInt(part, 10);
      if (!Number.isFinite(index)) {
        return undefined;
      }
      current = current[index];
      continue;
    }
    current = current[part];
  }
  return current;
}

function resolveReference(expression: unknown, context: Record<string, unknown>): unknown {
  if (typeof expression !== 'string') {
    return expression;
  }
  if (!expression.startsWith('$')) {
    return expression;
  }
  const withoutDollar = expression.slice(1);
  const dotIndex = withoutDollar.indexOf('.');
  if (dotIndex === -1) {
    return context[withoutDollar];
  }
  const base = withoutDollar.slice(0, dotIndex);
  const childPath = withoutDollar.slice(dotIndex + 1);
  return readByPath(context[base], childPath);
}

function toBufferSafe(value: unknown): Buffer | null {
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }
  if (typeof value === 'string' && value.startsWith('\\x')) {
    return Buffer.from(value.slice(2), 'hex');
  }
  return null;
}

function compileOperation(meta: MetaPack, coder: DirectAccountsCoder, options: AppPackViewReadServiceOptions): CompiledOperation {
  const operation = meta.reads?.contract?.[options.operationId];
  if (!operation) {
    throw new Error(`Read ${options.operationId} must be declared under reads.contract.`);
  }
  if (!operation.read || operation.read.kind !== 'account') {
    throw new Error(`Read ${options.operationId} must declare a targeted contract read.`);
  }
  return {
    protocolId: meta.protocol.protocolId,
    namespace: `${meta.protocol.protocolId}.${options.operationId}`,
    programId: parsePublicKey(options.programId, 'programId'),
    accountType: operation.read.target.account_type,
    accountSize: coder.size(operation.read.target.account_type),
    operationInputDefs: operation.inputs ?? {},
    select: operation.read.select,
    targetAddress: operation.read.target.address,
  };
}

export class AppPackViewReadService {
  private readonly connection: Connection;
  private readonly cacheTtlMs: number;
  private readonly pool: Pool | null;
  private readonly coder: DirectAccountsCoder;
  private readonly compiled: CompiledOperation;

  constructor(options: AppPackViewReadServiceOptions) {
    this.connection = options.connection;
    this.cacheTtlMs = options.cacheTtlMs;
    if (options.poolOverride) {
      this.pool = options.poolOverride;
    } else {
      this.pool = options.databaseUrl
        ? new Pool({
            connectionString: options.databaseUrl,
            max: 4,
          })
        : null;
    }

    const runtimePath = path.resolve(options.runtimePath);
    const meta = parseOperationPack(runtimePath);
    const codama = parseRuntimeCodamaDocument(runtimePath, options.protocolId);
    this.coder = new DirectAccountsCoder(codama);
    this.compiled = compileOperation(meta, this.coder, options);
  }

  hasDatabase(): boolean {
    return this.pool !== null;
  }

  async initialize(): Promise<void> {
    if (!this.pool) {
      return;
    }

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${ACCOUNT_CACHE_TABLE} (
        pubkey TEXT PRIMARY KEY,
        owner_program_id TEXT NOT NULL,
        slot BIGINT NOT NULL,
        lamports BIGINT NOT NULL,
        rent_epoch TEXT NOT NULL,
        executable BOOLEAN NOT NULL,
        data_bytes BYTEA NOT NULL,
        data_hash BYTEA NOT NULL,
        data_len INTEGER NOT NULL,
        source TEXT NOT NULL,
        first_seen_slot BIGINT NOT NULL DEFAULT 0,
        first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_slot BIGINT NOT NULL DEFAULT 0,
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_cached_program_accounts_owner_slot_pubkey
      ON ${ACCOUNT_CACHE_TABLE} (owner_program_id, slot DESC, pubkey);
    `);

    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_cached_program_accounts_owner_len
      ON ${ACCOUNT_CACHE_TABLE} (owner_program_id, data_len);
    `);
  }

  clearCache(): void {
    void this.cacheTtlMs;
  }

  getCacheStats(): { entries: number } {
    return { entries: 0 };
  }

  getNamespace(): string {
    return this.compiled.namespace;
  }

  async runRead(options: RunReadOptions): Promise<ReadResult> {
    const resolvedInput = this.resolveOperationInput(options.input);
    return this.runAccountRead(resolvedInput);
  }

  async syncFullToDatabase(): Promise<FullSyncResult | null> {
    return null;
  }

  async syncByAccountAddresses(_addresses: string[], slot: number): Promise<IncrementalSyncResult | null> {
    return {
      inputAccounts: 0,
      fetchedAccounts: 0,
      decodedAccounts: 0,
      upserted: 0,
      slot,
    };
  }

  async close(): Promise<void> {
    if (!this.pool) {
      return;
    }
    await this.pool.end();
  }

  private resolveOperationInput(rawInput: Record<string, unknown>): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};
    for (const [inputName, def] of Object.entries(this.compiled.operationInputDefs)) {
      const incoming = rawInput[inputName];
      if (incoming === undefined || incoming === null || incoming === '') {
        if (def.default !== undefined) {
          resolved[inputName] = def.default;
          continue;
        }
        if (def.required) {
          throw new Error(`Missing required input: ${inputName}`);
        }
        continue;
      }
      resolved[inputName] = incoming;
    }
    for (const [inputName, value] of Object.entries(rawInput)) {
      if (!(inputName in resolved)) {
        resolved[inputName] = value;
      }
    }
    return resolved;
  }

  private async runAccountRead(input: Record<string, unknown>): Promise<ReadResult> {
    const targetAddress = resolveReference(this.compiled.targetAddress, { input, param: input });
    if (typeof targetAddress !== 'string' || targetAddress.length === 0) {
      throw new Error(`Target address could not be resolved for ${this.compiled.namespace}.`);
    }
    const pubkey = parsePublicKey(targetAddress, 'target.address').toBase58();

    if (this.pool) {
      const dbResult = await this.fetchAccountByPubkey(pubkey, input);
      if (dbResult) {
        return dbResult;
      }
    }

    const info = await this.connection.getAccountInfo(new PublicKey(pubkey), 'confirmed');
    if (!info) {
      return {
        items: [],
        source: 'db',
        slot: 0,
        generatedAtMs: Date.now(),
      };
    }

    const selected = this.decodeAndSelect(pubkey, Buffer.from(info.data), input);
    return {
      items: selected ? [selected] : [],
      source: 'db',
      slot: 0,
      generatedAtMs: Date.now(),
    };
  }

  private async fetchAccountByPubkey(pubkey: string, input: Record<string, unknown>): Promise<ReadResult | null> {
    if (!this.pool) {
      return null;
    }
    const result = await this.pool.query<{
      pubkey: string;
      slot: string;
      first_seen_slot: string;
      last_seen_slot: string;
      data_bytes: unknown;
    }>(
      `
        SELECT
          pubkey,
          slot::text AS slot,
          first_seen_slot::text AS first_seen_slot,
          last_seen_slot::text AS last_seen_slot,
          data_bytes
        FROM ${ACCOUNT_CACHE_TABLE}
        WHERE owner_program_id = $1
          AND pubkey = $2
          AND data_len = $3
        LIMIT 1
      `,
      [this.compiled.programId.toBase58(), pubkey, this.compiled.accountSize],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    const accountData = toBufferSafe(row.data_bytes);
    if (!accountData) {
      return null;
    }
    const selected = this.decodeAndSelect(pubkey, accountData, input, {
      slot: Number.parseInt(row.slot, 10) || 0,
      firstSeenSlot: Number.parseInt(row.first_seen_slot, 10) || 0,
      lastSeenSlot: Number.parseInt(row.last_seen_slot, 10) || 0,
    });
    if (!selected) {
      return null;
    }
    return {
      items: [selected],
      source: 'db',
      slot: Number.parseInt(row.slot, 10) || 0,
      generatedAtMs: Date.now(),
    };
  }

  private decodeAndSelect(
    pubkey: string,
    accountData: Buffer,
    input: Record<string, unknown>,
    accountMeta?: { slot?: number; firstSeenSlot?: number; lastSeenSlot?: number },
  ): Record<string, unknown> | null {
    let decoded: Record<string, unknown>;
    try {
      decoded = this.coder.decode(this.compiled.accountType, accountData) as Record<string, unknown>;
    } catch {
      return null;
    }
    const row: DecodedAccountContext = {
      account: {
        pubkey,
        slot: accountMeta?.slot ?? 0,
        firstSeenSlot: accountMeta?.firstSeenSlot ?? 0,
        lastSeenSlot: accountMeta?.lastSeenSlot ?? 0,
      },
      decoded,
      input,
      protocol: {
        programId: this.compiled.programId.toBase58(),
      },
    };
    return this.mapSelect(this.compiled.select, row);
  }

  private mapSelect(select: Record<string, unknown>, row: DecodedAccountContext): Record<string, unknown> {
    const mapped: Record<string, unknown> = {};
    for (const [field, expression] of Object.entries(select)) {
      const value = resolveReference(expression, row as unknown as Record<string, unknown>);
      if (value === undefined) {
        continue;
      }
      if (typeof value === 'bigint') {
        mapped[field] = value.toString();
      } else if (typeof value === 'number') {
        mapped[field] = Number.isInteger(value) ? String(value) : value;
      } else if (isObjectRecord(value) && 'toBase58' in value && typeof value.toBase58 === 'function') {
        mapped[field] = value.toBase58();
      } else if (value && typeof value === 'object' && 'toString' in value && !Array.isArray(value)) {
        mapped[field] = String(value);
      } else {
        mapped[field] = value;
      }
    }
    return mapped;
  }
}
