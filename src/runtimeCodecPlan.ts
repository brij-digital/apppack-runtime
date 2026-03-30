import type { Idl } from '@coral-xyz/anchor';
import { loadProtocolRuntimeSpec } from './idlRegistry.js';
import { resolveAppUrl } from './appUrl.js';

type RuntimeCodecPlanArtifact = {
  artifact?: string;
  family?: string;
  codamaPath?: string;
  anchorIdl?: Idl;
};

type RuntimeCodecPlanProtocol = {
  protocolId?: string;
  programId?: string;
  artifacts?: Record<string, RuntimeCodecPlanArtifact>;
};

type RuntimeCodecPlanDocument = {
  schema?: string;
  protocols?: RuntimeCodecPlanProtocol[];
};

const codecPlanCache = new Map<string, Idl>();
let codecPlanDocumentCache: RuntimeCodecPlanDocument | null = null;

async function loadRuntimeCodecPlanDocument(): Promise<RuntimeCodecPlanDocument> {
  if (codecPlanDocumentCache) {
    return codecPlanDocumentCache;
  }
  const response = await fetch(resolveAppUrl('/idl/runtime-codec-plan.json'));
  if (!response.ok) {
    throw new Error('Failed to load runtime codec plan.');
  }
  const parsed = (await response.json()) as RuntimeCodecPlanDocument;
  if (parsed.schema !== 'apppack-runtime-codec-plan.v1') {
    throw new Error(`runtime codec plan schema mismatch: ${String(parsed.schema)}`);
  }
  codecPlanDocumentCache = parsed;
  return parsed;
}

async function resolveProtocolCodecArtifactName(protocolId: string): Promise<string> {
  const runtime = await loadProtocolRuntimeSpec(protocolId);
  if (!runtime) {
    throw new Error(`Protocol ${protocolId} has no runtime spec; runtime codec plan requires runtime-backed protocols.`);
  }
  const artifactNames = Object.keys(runtime.decoderArtifacts ?? {});
  if (artifactNames.length === 0) {
    throw new Error(`Protocol ${protocolId} runtime spec declares no decoder artifacts.`);
  }
  if (artifactNames.length > 1) {
    throw new Error(`Protocol ${protocolId} declares multiple decoder artifacts; runtime codec plan resolution is ambiguous.`);
  }
  return artifactNames[0]!;
}

export async function loadProtocolCodecIdl(protocolId: string): Promise<Idl> {
  if (codecPlanCache.has(protocolId)) {
    return codecPlanCache.get(protocolId)!;
  }

  const plan = await loadRuntimeCodecPlanDocument();
  const protocol = plan.protocols?.find((entry) => entry.protocolId === protocolId);
  if (!protocol) {
    throw new Error(`Protocol ${protocolId} is missing from runtime codec plan.`);
  }
  const artifactName = await resolveProtocolCodecArtifactName(protocolId);
  const idl = protocol.artifacts?.[artifactName]?.anchorIdl;
  if (!idl) {
    throw new Error(`Protocol ${protocolId} artifact ${artifactName} is missing anchorIdl in runtime codec plan.`);
  }
  codecPlanCache.set(protocolId, idl);
  return idl;
}
