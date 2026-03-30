import { resolveAppUrl } from './appUrl.js';

export type ProtocolManifest = {
  id: string;
  name: string;
  network: string;
  programId: string;
  codamaIdlPath?: string;
  runtimeSpecPath?: string;
  transport: string;
  supportedCommands: string[];
  status: 'active' | 'inactive';
};

type RegistryShape = {
  version: string;
  globalCommands?: string[];
  protocols: ProtocolManifest[];
};

type RuntimeDecoderArtifact = {
  codamaPath?: string;
};

type RuntimeSpecShape = {
  schema: string;
  protocolId: string;
  decoderArtifacts?: Record<string, RuntimeDecoderArtifact>;
};

let registryCache: RegistryShape | null = null;
const runtimeSpecCache = new Map<string, RuntimeSpecShape | null>();

export async function loadRegistry(): Promise<RegistryShape> {
  if (registryCache) {
    return registryCache;
  }

  const response = await fetch(resolveAppUrl('/idl/registry.json'));
  if (!response.ok) {
    throw new Error('Failed to load local IDL registry.');
  }

  const parsed = (await response.json()) as RegistryShape;
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

async function loadJsonByPath<T>(filePath: string): Promise<T> {
  const response = await fetch(resolveAppUrl(filePath));
  if (!response.ok) {
    throw new Error(`Failed to load JSON from ${filePath}.`);
  }
  return (await response.json()) as T;
}

export async function loadProtocolRuntimeSpec(protocolId: string): Promise<RuntimeSpecShape | null> {
  if (runtimeSpecCache.has(protocolId)) {
    return runtimeSpecCache.get(protocolId)!;
  }

  const manifest = await getProtocolById(protocolId);
  if (!manifest.runtimeSpecPath) {
    runtimeSpecCache.set(protocolId, null);
    return null;
  }

  const parsed = await loadJsonByPath<RuntimeSpecShape>(manifest.runtimeSpecPath);
  if (parsed.schema !== 'declarative-decoder-runtime.v1') {
    throw new Error(`Protocol ${protocolId} runtime spec at ${manifest.runtimeSpecPath} is not declarative-decoder-runtime.v1.`);
  }
  if (parsed.protocolId !== protocolId) {
    throw new Error(`Protocol ${protocolId} runtime spec protocolId mismatch: ${parsed.protocolId}.`);
  }

  runtimeSpecCache.set(protocolId, parsed);
  return parsed;
}
