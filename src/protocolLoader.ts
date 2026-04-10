import fs from 'node:fs';
import path from 'node:path';

const PROTOCOL_URL_RE = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;
const IDL_CACHE_BUST_VERSION = 'runtime-0.1.65';

type ImportMetaWithOptionalEnv = ImportMeta & {
  env?: {
    BASE_URL?: string;
  };
};

export type ProtocolManifest = {
  id: string;
  name: string;
  network: string;
  programId: string;
  codamaIdlPath?: string;
  agentRuntimePath?: string;
  transport: string;
  supportedCommands: string[];
  status: 'active' | 'inactive';
};

type RegistryShape = {
  version: string;
  globalCommands?: string[];
  protocols: ProtocolManifest[];
  indexings?: Array<{
    id: string;
    entitySchemaPath?: string;
    sources: Array<{
      id: string;
      protocolId: string;
      ingestSpecPath: string;
      dependsOn?: string[];
    }>;
    status: 'active' | 'inactive';
  }>;
};

type AgentRuntimeShape = {
  schema: string;
  protocol_id: string;
  program_id: string;
  codama_path: string;
  label?: string;
  views?: Record<string, unknown>;
  writes?: Record<string, unknown>;
  transforms?: Record<string, unknown>;
};

type JsonRecord = Record<string, unknown>;

let registryCache: RegistryShape | null = null;
const jsonCache = new Map<string, Promise<JsonRecord>>();
const agentRuntimeCache = new Map<string, AgentRuntimeShape | null>();
const protocolCodamaCache = new Map<string, Promise<JsonRecord>>();

function resolveRuntimeBaseUrl(): string {
  const importMetaBase = (import.meta as ImportMetaWithOptionalEnv).env?.BASE_URL;
  if (typeof importMetaBase === 'string' && importMetaBase.trim().length > 0) {
    return importMetaBase;
  }

  const processBase =
    typeof process !== 'undefined' && process.env
      ? process.env.APPPACK_RUNTIME_BASE_URL
      : undefined;
  if (typeof processBase === 'string' && processBase.trim().length > 0) {
    return processBase;
  }

  if (typeof window === 'undefined') {
    return 'http://127.0.0.1:8080';
  }

  return '/';
}

function normalizeBaseUrl(baseRaw: string | undefined): string {
  const trimmed = (baseRaw ?? '/').trim();
  if (!trimmed) {
    return '/';
  }
  if (PROTOCOL_URL_RE.test(trimmed) || trimmed.startsWith('//')) {
    return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
  }
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`;
}

function resolveAppUrl(url: string): string {
  const withCacheBust = (resolved: string): string => {
    if (!resolved.includes('/idl/') || !resolved.endsWith('.json')) {
      return resolved;
    }
    const separator = resolved.includes('?') ? '&' : '?';
    return `${resolved}${separator}v=${IDL_CACHE_BUST_VERSION}`;
  };

  if (PROTOCOL_URL_RE.test(url) || url.startsWith('//')) {
    return withCacheBust(url);
  }

  const base = normalizeBaseUrl(resolveRuntimeBaseUrl());

  if (url.startsWith('/')) {
    if (base === '/') {
      return withCacheBust(url);
    }
    return withCacheBust(`${base.slice(0, -1)}${url}`);
  }

  const cleaned = url.replace(/^\.\//, '');
  if (base === '/') {
    return withCacheBust(`/${cleaned}`);
  }
  return withCacheBust(`${base}${cleaned}`);
}

function resolveLocalRegistryPath(): string | null {
  if (typeof window !== 'undefined') {
    return null;
  }
  const explicit =
    typeof process !== 'undefined' && process.env
      ? process.env.APPPACK_RUNTIME_REGISTRY_PATH
      : undefined;
  if (typeof explicit !== 'string' || explicit.trim().length === 0) {
    return null;
  }
  return path.resolve(explicit.trim());
}

function readLocalJson<T>(absolutePath: string): T {
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8')) as T;
}

function resolveLocalJsonPath(localRegistryPath: string, filePath: string): string {
  if (!filePath.startsWith('/')) {
    throw new Error(`Local runtime registry only supports root-relative JSON paths. Got ${filePath}.`);
  }

  const registryDir = path.dirname(localRegistryPath);
  if (filePath.startsWith('/idl/')) {
    const relativePath = filePath.slice('/idl/'.length);
    const siblingPath = path.resolve(registryDir, relativePath);
    if (fs.existsSync(siblingPath)) {
      return siblingPath;
    }

    const nestedIdlPath = path.resolve(registryDir, 'idl', relativePath);
    if (fs.existsSync(nestedIdlPath)) {
      return nestedIdlPath;
    }
  }

  return path.resolve(registryDir, filePath.slice(1));
}

async function loadJsonByPath<T extends JsonRecord>(filePath: string): Promise<T> {
  if (!jsonCache.has(filePath)) {
    const localRegistryPath = resolveLocalRegistryPath();
    if (localRegistryPath) {
      const resolvedPath = resolveLocalJsonPath(localRegistryPath, filePath);
      jsonCache.set(filePath, Promise.resolve(readLocalJson<JsonRecord>(resolvedPath)));
    } else {
      jsonCache.set(
        filePath,
        fetch(resolveAppUrl(filePath)).then(async (response) => {
          if (!response.ok) {
            throw new Error(`Failed to load JSON from ${filePath}.`);
          }
          return (await response.json()) as JsonRecord;
        }),
      );
    }
  }
  return (await jsonCache.get(filePath)!) as T;
}

export async function loadRegistry(): Promise<RegistryShape> {
  if (registryCache) {
    return registryCache;
  }

  const localRegistryPath = resolveLocalRegistryPath();
  if (localRegistryPath) {
    const parsed = readLocalJson<RegistryShape>(localRegistryPath);
    registryCache = parsed;
    return parsed;
  }

  const parsed = await loadJsonByPath<RegistryShape>('/idl/registry.json');
  registryCache = parsed;
  return parsed;
}

export async function getProtocolById(protocolId: string): Promise<ProtocolManifest> {
  const registry = await loadRegistry();
  const manifest = registry.protocols.find((protocol) => protocol.id === protocolId);

  if (!manifest) {
    throw new Error(`Protocol ${protocolId} not found in local IDL registry.`);
  }
  if (manifest.status === 'inactive') {
    throw new Error(`Protocol ${protocolId} is inactive in the local IDL registry.`);
  }

  return manifest;
}

export async function loadProtocolAgentRuntime(protocolId: string): Promise<AgentRuntimeShape | null> {
  if (agentRuntimeCache.has(protocolId)) {
    return agentRuntimeCache.get(protocolId)!;
  }

  const manifest = await getProtocolById(protocolId);
  if (!manifest.agentRuntimePath) {
    agentRuntimeCache.set(protocolId, null);
    return null;
  }

  const parsed = await loadJsonByPath<AgentRuntimeShape>(manifest.agentRuntimePath);
  if (parsed.schema !== 'solana-agent-runtime.v1') {
    throw new Error(
      `Protocol ${protocolId} agent runtime at ${manifest.agentRuntimePath} is not solana-agent-runtime.v1.`,
    );
  }
  if (parsed.protocol_id !== protocolId) {
    throw new Error(`Protocol ${protocolId} agent runtime protocol_id mismatch: ${parsed.protocol_id}.`);
  }
  if (parsed.program_id !== manifest.programId) {
    throw new Error(`Protocol ${protocolId} agent runtime program_id mismatch: ${parsed.program_id}.`);
  }
  if (parsed.codama_path !== manifest.codamaIdlPath) {
    throw new Error(`Protocol ${protocolId} agent runtime codama_path mismatch: ${parsed.codama_path}.`);
  }

  agentRuntimeCache.set(protocolId, parsed);
  return parsed;
}

export async function loadProtocolCodamaDocument(protocolId: string): Promise<JsonRecord> {
  if (!protocolCodamaCache.has(protocolId)) {
    protocolCodamaCache.set(
      protocolId,
      (async () => {
        const protocol = await getProtocolById(protocolId);
        if (typeof protocol.codamaIdlPath !== 'string' || protocol.codamaIdlPath.trim().length === 0) {
          throw new Error(`${protocolId}.codamaIdlPath must be a non-empty string.`);
        }
        return await loadJsonByPath<JsonRecord>(protocol.codamaIdlPath);
      })(),
    );
  }
  return await protocolCodamaCache.get(protocolId)!;
}
