import { PublicKey, type Connection, type Commitment, type GetProgramAccountsFilter } from '@solana/web3.js';
import { Buffer } from 'buffer';
import bs58 from 'bs58';
import { resolveAppUrl } from './appUrl.js';
import { isBnLike } from './bnLike.js';
import { findCodamaAccountByName, type CodamaDocument as Idl } from './codamaIdl.js';
import { DirectAccountsCoder } from './directAccountsCoder.js';

export type DiscoverStepResolved = {
  name: string;
  discover: string;
  [key: string]: unknown;
};

export type DiscoverRuntimeContext = {
  protocolId: string;
  programId: string;
  connection: Connection;
  walletPublicKey: PublicKey;
  idl: Idl;
  scope: Record<string, unknown>;
};

export type DiscoverExecutor = (step: DiscoverStepResolved, ctx: DiscoverRuntimeContext) => Promise<unknown>;

const discoverHttpCache = new Map<string, { expiresAt: number; value: unknown }>();

function asString(value: unknown, label: string): string {
  if (typeof value === 'string') {
    return value;
  }
  throw new Error(`${label} must be a string.`);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  return value;
}

function asBoolean(value: unknown, label: string): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  throw new Error(`${label} must be a boolean.`);
}

function asSafeInteger(value: unknown, label: string): number {
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return value;
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) {
      return parsed;
    }
  }
  throw new Error(`${label} must be an integer.`);
}

function asPubkey(value: unknown, label: string): PublicKey {
  if (value instanceof PublicKey) {
    return value;
  }
  if (typeof value === 'string') {
    return new PublicKey(value);
  }
  throw new Error(`${label} must be a public key.`);
}

function asFiniteNumber(value: unknown, label: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  throw new Error(`${label} must be a finite number.`);
}

function asNumberLike(value: unknown, label: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  throw new Error(`${label} must be number-like.`);
}

function asCommitment(value: unknown, label: string): Commitment {
  if (value === 'processed' || value === 'confirmed' || value === 'finalized') {
    return value;
  }
  throw new Error(`${label} must be one of processed|confirmed|finalized.`);
}

function readPathFromValue(value: unknown, path: string): unknown {
  const cleaned = path.startsWith('$') ? path.slice(1) : path;
  const parts = cleaned.split('.').filter(Boolean);
  let current: unknown = value;

  for (const part of parts) {
    if (!current || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

function resolvePathMaybe(scope: Record<string, unknown>, path: string): unknown {
  const cleaned = path.startsWith('$') ? path.slice(1) : path;
  return readPathFromValue(scope, cleaned);
}

function resolveTemplateWithScope(
  value: unknown,
  scope: Record<string, unknown>,
  options?: { keepUnresolvedPaths?: boolean },
): unknown {
  if (typeof value === 'string' && value.startsWith('$')) {
    const resolved = resolvePathMaybe(scope, value);
    if (resolved === undefined) {
      if (options?.keepUnresolvedPaths) {
        return value;
      }
      throw new Error(`Could not resolve template path ${value}.`);
    }
    return resolved;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => resolveTemplateWithScope(entry, scope, options));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        resolveTemplateWithScope(entry, scope, options),
      ]),
    );
  }

  return value;
}

function resolveOptionalGlobalPathValue(value: unknown, scope: Record<string, unknown>): unknown {
  if (typeof value === 'string' && value.startsWith('$')) {
    return resolvePathMaybe(scope, value);
  }
  return value;
}

function normalizeRuntimeValue(value: unknown): unknown {
  if (isBnLike(value)) {
    return (value as { toString(): string }).toString();
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (value instanceof PublicKey) {
    return value.toBase58();
  }

  if (Array.isArray(value)) {
    return value.map(normalizeRuntimeValue);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, normalizeRuntimeValue(nested)]),
    );
  }

  return value;
}

function normalizeComparable(value: unknown): unknown {
  const normalized = normalizeRuntimeValue(value);
  if (Array.isArray(normalized)) {
    return normalized.map(normalizeComparable);
  }

  if (normalized && typeof normalized === 'object') {
    const entries = Object.entries(normalized as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => [key, normalizeComparable(nested)] as const);
    return Object.fromEntries(entries);
  }

  return normalized;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(normalizeComparable(left)) === JSON.stringify(normalizeComparable(right));
}

function toComparableBigint(value: unknown): bigint | null {
  if (typeof value === 'bigint') {
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)) {
    return BigInt(value);
  }

  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    return BigInt(value);
  }

  return null;
}

function compareOrdered(left: unknown, right: unknown): number {
  const leftBigint = toComparableBigint(left);
  const rightBigint = toComparableBigint(right);
  if (leftBigint !== null && rightBigint !== null) {
    if (leftBigint === rightBigint) {
      return 0;
    }
    return leftBigint > rightBigint ? 1 : -1;
  }

  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    if (leftNumber === rightNumber) {
      return 0;
    }
    return leftNumber > rightNumber ? 1 : -1;
  }

  return String(left).localeCompare(String(right));
}

type QueryWhereOp = '==' | '=' | '!=' | '>' | '>=' | '<' | '<=';

type QueryWhereClause = {
  path: string;
  op?: QueryWhereOp;
  value: unknown;
};

type QuerySortClause = {
  path: string;
  dir?: 'asc' | 'desc';
};

type ProgramAccountLike = {
  pubkey: PublicKey;
  account: {
    data: Uint8Array;
    executable: boolean;
    lamports: number;
    owner: PublicKey;
  };
};

function parseQueryWhereClause(raw: unknown, label: string): QueryWhereClause {
  const clause = asRecord(raw, label);
  return {
    path: asString(clause.path, `${label}.path`),
    op: clause.op === undefined ? '==' : (asString(clause.op, `${label}.op`) as QueryWhereOp),
    value: clause.value,
  };
}

function parseQuerySortClause(raw: unknown, label: string): QuerySortClause {
  const clause = asRecord(raw, label);
  const dir = clause.dir === undefined ? 'asc' : asString(clause.dir, `${label}.dir`);
  if (dir !== 'asc' && dir !== 'desc') {
    throw new Error(`${label}.dir must be asc|desc.`);
  }
  return {
    path: asString(clause.path, `${label}.path`),
    dir,
  };
}

function matchesWhere(scope: Record<string, unknown>, clauses: QueryWhereClause[]): boolean {
  return clauses.every((clause) => {
    const actual = readPathFromValue(scope, clause.path);
    const op = clause.op ?? '==';
    if (op === '=' || op === '==') {
      return valuesEqual(actual, clause.value);
    }

    if (op === '!=') {
      return !valuesEqual(actual, clause.value);
    }

    const ordered = compareOrdered(actual, clause.value);
    if (op === '>') {
      return ordered > 0;
    }
    if (op === '>=') {
      return ordered >= 0;
    }
    if (op === '<') {
      return ordered < 0;
    }
    if (op === '<=') {
      return ordered <= 0;
    }
    throw new Error(`Unsupported where op ${String(op)}.`);
  });
}

function resolveMemcmpBytes(value: unknown, label: string): string {
  if (value instanceof PublicKey) {
    return value.toBase58();
  }
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  throw new Error(`${label} must be a base58 string or public key.`);
}

function parseRpcProgramFilter(raw: unknown, label: string): GetProgramAccountsFilter {
  const filter = asRecord(raw, label);
  if ('memcmp' in filter) {
    const memcmp = asRecord(filter.memcmp, `${label}.memcmp`);
    const offset = asSafeInteger(memcmp.offset, `${label}.memcmp.offset`);
    const hasBytes = memcmp.bytes !== undefined;
    const hasBytesFrom = memcmp.bytesFrom !== undefined;
    if (hasBytes === hasBytesFrom) {
      throw new Error(`${label}.memcmp requires exactly one of bytes or bytesFrom.`);
    }
    const bytes = hasBytes
      ? resolveMemcmpBytes(memcmp.bytes, `${label}.memcmp.bytes`)
      : resolveMemcmpBytes(memcmp.bytesFrom, `${label}.memcmp.bytesFrom`);
    return {
      memcmp: {
        offset,
        bytes,
      },
    };
  }

  if ('dataSize' in filter) {
    return {
      dataSize: asSafeInteger(filter.dataSize, `${label}.dataSize`),
    };
  }

  throw new Error(`${label} must be a memcmp or dataSize filter.`);
}

function decodeBase64ToBytes(base64: string): Buffer {
  return Buffer.from(base64, 'base64');
}

function asProgramAccountLike(entry: unknown, label: string): ProgramAccountLike {
  const record = asRecord(entry, `${label}`);
  const pubkey = asPubkey(record.pubkey, `${label}.pubkey`);
  const accountRaw = asRecord(record.account, `${label}.account`);
  const owner = asPubkey(accountRaw.owner, `${label}.account.owner`);
  const lamports = Math.trunc(asNumberLike(accountRaw.lamports, `${label}.account.lamports`));
  const executable = asBoolean(accountRaw.executable, `${label}.account.executable`);
  const dataRaw = accountRaw.data;

  let data: Uint8Array;
  if (Array.isArray(dataRaw) && dataRaw.length >= 1 && typeof dataRaw[0] === 'string') {
    data = decodeBase64ToBytes(dataRaw[0] as string);
  } else if (typeof dataRaw === 'string') {
    data = decodeBase64ToBytes(dataRaw);
  } else {
    throw new Error(`${label}.account.data must be base64 string or [base64, encoding].`);
  }

  return {
    pubkey,
    account: {
      data,
      executable,
      lamports,
      owner,
    },
  };
}

function idlDiscriminatorFilter(idl: Idl, accountType: string, label: string): GetProgramAccountsFilter {
  const idlAccount = findCodamaAccountByName(idl, accountType);
  if (!idlAccount || !idlAccount.discriminator || idlAccount.discriminator.length !== 8) {
    throw new Error(`${label}: account_type ${accountType} is missing discriminator in IDL.`);
  }

  const discriminatorBytes = Uint8Array.from(idlAccount.discriminator);
  const discriminatorBase58 = bs58.encode(discriminatorBytes);
  return {
    memcmp: {
      offset: 0,
      bytes: discriminatorBase58,
    },
  };
}

function buildUrlWithQuery(url: string, query: Record<string, unknown>): string {
  const entries = Object.entries(query);
  if (entries.length === 0) {
    return url;
  }

  const params = new URLSearchParams();
  for (const [key, value] of entries) {
    if (value === undefined || value === null) {
      continue;
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      params.set(key, String(value));
      continue;
    }

    params.set(key, JSON.stringify(value));
  }

  const queryString = params.toString();
  if (!queryString) {
    return url;
  }

  return `${url}${url.includes('?') ? '&' : '?'}${queryString}`;
}

async function runDiscoverMock(step: DiscoverStepResolved): Promise<unknown> {
  if (step.value === undefined) {
    throw new Error(`discover:${step.name}:value is required for discover.mock.`);
  }
  return step.value;
}

async function runDiscoverQueryHttpJson(step: DiscoverStepResolved): Promise<unknown> {
  const url = asString(step.url, `discover:${step.name}:url`);
  const query = step.query === undefined ? {} : asRecord(step.query, `discover:${step.name}:query`);
  const itemsPath =
    step.items_path === undefined ? undefined : asString(step.items_path, `discover:${step.name}:items_path`);
  const selectPath =
    step.select_path === undefined ? undefined : asString(step.select_path, `discover:${step.name}:select_path`);
  const maxAgeMs =
    step.max_age_ms === undefined ? 0 : asSafeInteger(step.max_age_ms, `discover:${step.name}:max_age_ms`);

  const resolvedUrl = buildUrlWithQuery(url, query);
  const cacheKey = `${step.discover}:${resolvedUrl}:${itemsPath ?? ''}:${selectPath ?? ''}`;
  const now = Date.now();
  const cached = discoverHttpCache.get(cacheKey);
  if (cached && cached.expiresAt >= now) {
    return cached.value;
  }

  const response = await fetch(resolveAppUrl(resolvedUrl));
  if (!response.ok) {
    throw new Error(`discover:${step.name}:fetch failed: ${response.status} ${response.statusText}`);
  }

  const body = (await response.json()) as unknown;
  let result: unknown = body;

  if (itemsPath) {
    result = readPathFromValue(result, itemsPath);
    if (result === undefined) {
      throw new Error(`discover:${step.name}:items_path ${itemsPath} not found.`);
    }
  }

  if (selectPath) {
    result = readPathFromValue(result, selectPath);
    if (result === undefined) {
      throw new Error(`discover:${step.name}:select_path ${selectPath} not found.`);
    }
  }

  if (maxAgeMs > 0) {
    discoverHttpCache.set(cacheKey, {
      expiresAt: now + maxAgeMs,
      value: result,
    });
  }

  return result;
}

async function runDiscoverCompareValues(step: DiscoverStepResolved): Promise<unknown> {
  const items = asArray(step.items, `discover:${step.name}:items`);
  if (items.length === 0) {
    throw new Error(`discover:${step.name}: no candidates found.`);
  }

  const mode = step.mode === undefined ? 'first' : asString(step.mode, `discover:${step.name}:mode`);
  if (mode === 'first') {
    return items[0];
  }

  const metricPath = asString(step.metric_path, `discover:${step.name}:metric_path`);
  const pickMax = mode === 'max';
  const pickMin = mode === 'min';
  if (!pickMax && !pickMin) {
    throw new Error(`discover:${step.name}:mode must be one of first|max|min.`);
  }

  let selected = items[0];
  let selectedMetric = asFiniteNumber(
    readPathFromValue(selected, metricPath),
    `discover:${step.name}:items[0].${metricPath}`,
  );

  for (let i = 1; i < items.length; i += 1) {
    const itemMetric = asFiniteNumber(
      readPathFromValue(items[i], metricPath),
      `discover:${step.name}:items[${i}].${metricPath}`,
    );
    if ((pickMax && itemMetric > selectedMetric) || (pickMin && itemMetric < selectedMetric)) {
      selected = items[i];
      selectedMetric = itemMetric;
    }
  }

  return selected;
}

async function runDiscoverPickListItem(step: DiscoverStepResolved): Promise<unknown> {
  const items = asArray(step.items, `discover:${step.name}:items`);
  if (items.length === 0) {
    throw new Error(`discover:${step.name}: no candidates found.`);
  }

  if (step.index === undefined) {
    throw new Error(`discover:${step.name}: index is required (no implicit default).`);
  }
  const indexRaw = asSafeInteger(step.index, `discover:${step.name}:index`);
  if (indexRaw < 0 || indexRaw >= items.length) {
    throw new Error(`discover:${step.name}:index ${indexRaw} is out of bounds for ${items.length} item(s).`);
  }

  return items[indexRaw];
}

function resolvePathFromScope(scope: Record<string, unknown>, path: string): unknown {
  const cleaned = path.startsWith('$') ? path.slice(1) : path;
  return readPathFromValue(scope, cleaned);
}

function resolveItemsMaybe(step: DiscoverStepResolved, ctx: DiscoverRuntimeContext): unknown[] {
  const rawItems = step.items;
  if (typeof rawItems === 'string' && rawItems.startsWith('$')) {
    const resolved = resolvePathFromScope(ctx.scope, rawItems);
    return asArray(resolved, `discover:${step.name}:items`);
  }
  return asArray(rawItems, `discover:${step.name}:items`);
}

function resolveOptionalMatchValue(step: DiscoverStepResolved, ctx: DiscoverRuntimeContext): unknown {
  const raw = step.match_value;
  if (typeof raw === 'string' && raw.startsWith('$')) {
    return resolvePathFromScope(ctx.scope, raw);
  }
  return raw;
}

async function runDiscoverPickListItemByValue(step: DiscoverStepResolved, ctx: DiscoverRuntimeContext): Promise<unknown> {
  const items = resolveItemsMaybe(step, ctx);
  if (items.length === 0) {
    throw new Error(`discover:${step.name}: no candidates found.`);
  }

  const valuePath = asString(step.value_path, `discover:${step.name}:value_path`);
  if (step.fallback_index !== undefined) {
    throw new Error(`discover:${step.name}: fallback_index is not supported (no silent fallback).`);
  }

  const resolvedMatchValue = resolveOptionalMatchValue(step, ctx);
  const isUnresolvedPath = resolvedMatchValue === undefined;
  const hasMatchValue =
    !isUnresolvedPath &&
    resolvedMatchValue !== null &&
    String(resolvedMatchValue).length > 0;
  if (!hasMatchValue) {
    throw new Error(`discover:${step.name}: match_value is required and must be non-empty.`);
  }

  for (const item of items) {
    const candidate = readPathFromValue(item, valuePath);
    if (valuesEqual(candidate, resolvedMatchValue)) {
      return item;
    }
  }

  throw new Error(
    `discover:${step.name}: no item matched value_path=${valuePath} for match_value=${String(resolvedMatchValue)}.`,
  );
}

const DISCOVER_EXECUTORS: Record<string, DiscoverExecutor> = {
  'discover.mock': runDiscoverMock,
  'discover.query_http_json': runDiscoverQueryHttpJson,
  'discover.compare_values': runDiscoverCompareValues,
  'discover.pick_list_item': runDiscoverPickListItem,
  'discover.pick_list_item_by_value': runDiscoverPickListItemByValue,
};

export async function runRegisteredDiscoverStep(step: DiscoverStepResolved, ctx: DiscoverRuntimeContext): Promise<unknown> {
  const executor = DISCOVER_EXECUTORS[step.discover];
  if (!executor) {
    throw new Error(`Unsupported discover step: ${step.discover}`);
  }

  return executor(step, ctx);
}
