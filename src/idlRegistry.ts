import { resolveAppUrl } from './appUrl.js';

export type ProtocolManifest = {
  id: string;
  name: string;
  network: string;
  programId: string;
  codamaIdlPath?: string;
  agentRuntimePath?: string;
  indexingSpecPath?: string;
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

type IndexingSpecShape = {
  schema: string;
  protocolId: string;
  decoderArtifacts?: Record<string, RuntimeDecoderArtifact>;
};

type AgentRuntimeShape = {
  schema: string;
  protocol: {
    protocolId?: string;
    programId?: string;
    codamaPath?: string;
  };
};

let registryCache: RegistryShape | null = null;
const indexingSpecCache = new Map<string, IndexingSpecShape | null>();
const agentRuntimeCache = new Map<string, AgentRuntimeShape | null>();

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

export async function loadProtocolIndexingSpec(protocolId: string): Promise<IndexingSpecShape | null> {
  if (indexingSpecCache.has(protocolId)) {
    return indexingSpecCache.get(protocolId)!;
  }

  const manifest = await getProtocolById(protocolId);
  if (!manifest.indexingSpecPath) {
    indexingSpecCache.set(protocolId, null);
    return null;
  }

  const parsed = await loadJsonByPath<IndexingSpecShape>(manifest.indexingSpecPath);
  if (parsed.schema !== 'declarative-decoder-runtime.v1') {
    throw new Error(`Protocol ${protocolId} indexing spec at ${manifest.indexingSpecPath} is not declarative-decoder-runtime.v1.`);
  }
  if (parsed.protocolId !== protocolId) {
    throw new Error(`Protocol ${protocolId} indexing spec protocolId mismatch: ${parsed.protocolId}.`);
  }

  indexingSpecCache.set(protocolId, parsed);
  return parsed;
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
    throw new Error(`Protocol ${protocolId} agent runtime at ${manifest.agentRuntimePath} is not solana-agent-runtime.v1.`);
  }
  if (parsed.protocol?.protocolId !== protocolId) {
    throw new Error(`Protocol ${protocolId} agent runtime protocolId mismatch: ${String(parsed.protocol?.protocolId)}.`);
  }

  agentRuntimeCache.set(protocolId, parsed);
  return parsed;
}
