# Solana Agent Runtime Migration Plan

## Goal

Replace protocol-specific MCP-style behavior with a single declarative, AI-facing Solana contract that lets an agent:

- understand a protocol
- navigate to the right entity
- read the data it needs
- compute previews or quotes
- draft, simulate, and submit transactions

The target is not "one custom MCP per protocol".
The target is:

- `Codama` as protocol truth
- an `indexing` spec for backend ingest/projections
- an `agent runtime` spec for AI-facing reads/computes/executions

## Problem With The Current Runtime Spec

The current `declarative_decoder_runtime.v1` mixes too many concerns in one file:

- ingest/indexing:
  - `decoderArtifacts`
  - `sources`
  - `matchRules`
  - `pipelines`
  - `projectionSpecs`
- reads:
  - `contract_view`
  - `index_view`
- execution:
  - `inputs`
  - `use`
  - `derive`
  - `compute`
  - `args`
  - `accounts`
- light UI residue:
  - `read_output`
  - some `bind_from` usages that are really form wiring

This creates several structural problems:

1. the top-level document is both a backend ingest DSL and an agent-facing operation DSL
2. `operations` is an overloaded bag containing unrelated capabilities
3. `contract_view` and `index_view` are still semantically blurry
4. some `index_view` definitions mix canonical reads and account-change discovery in one shape
5. some execution specs still carry noisy self-bindings like `bind_from: "$input.*"`
6. `read_output` keeps presentation concerns inside runtime

## Design Principle

The spec should be organized around agent capabilities, not historical implementation layers.

An agent needs to answer these questions in order:

1. what protocol is this?
2. how do I orient myself in it?
3. what can I read?
4. what can I compute?
5. what can I execute?

## Target Contract

The new AI-facing contract should look like:

```json
{
  "schema": "solana-agent-runtime.v1",
  "protocol": {},
  "navigation": {},
  "reads": {
    "contract": {},
    "index": {}
  },
  "computes": {},
  "executions": {}
}
```

This is intentionally not backward compatible.

## Spec Responsibilities

### 1. `protocol`

Protocol identity and canonical references.

Owns:

- `protocolId`
- `label`
- `programId`
- `codamaPath`
- canonical object references

It answers:

- what on-chain program is this?
- which Codama document defines it?

### 2. `navigation`

Agent-oriented orientation map.

Owns:

- `entities`
- `entrypoints`
- `relations`
- `recipes`

It answers:

- what are the important entities?
- how do I move from token to pool to quote to execution?
- which read/compute/execution capability should I call first?

This is not a protocol truth layer and not an execution layer.
It is an AI guidance layer.

### 3. `reads.contract`

Targeted on-chain or targeted RPC-backed reads.

Rules:

- must be targeted
- may decode
- may compute after reading
- may not perform broad account discovery

Allowed:

- single account reads
- known-address lookups
- small known-account bundles
- pool snapshot style reads
- quote-like reads when the target account is already known

Forbidden:

- broad `getProgramAccounts` search
- program-wide directory scans
- generic ranking/discovery logic

### 4. `reads.index`

Index-backed reads.

Owns:

- canonical reads
- discovery
- listings
- feeds
- rankings
- series

This is where:

- `list_pools`
- `list_tokens`
- `trade_feed`
- `ranked_active_tokens`
- `market_cap_series`

should live.

### 5. `computes`

Derived, non-transactional outputs.

Owns:

- quotes
- previews
- derived calculations
- protocol-specific score or estimation functions

These may depend on:

- inputs
- contract reads
- index reads

But they do not submit transactions.

Example:

- Orca `quote_exact_in`
- Pump buy/sell preview

### 6. `executions`

Transaction preparation and submission contract.

Owns:

- inputs
- derive
- compute needed only for tx preparation
- args
- accounts
- pre/post instructions
- instruction/template binding

Execution should depend on prior reads/computes explicitly instead of hiding them inside one giant operation.

## The Clean Split

We should stop treating one runtime file as both:

- backend indexing truth
- AI-facing interaction truth

The correct split is:

### A. Indexing Spec

Keep a backend-oriented spec for:

- decoder artifacts
- ingest sources
- match rules
- pipelines
- projection specs

This continues to power the indexer and backend workers.

### B. Agent Runtime Spec

Create a new AI-facing spec for:

- protocol
- navigation
- reads
- computes
- executions

This powers:

- wallet UI
- AI agents
- transaction drafting/simulation
- read orchestration

## What To Remove From The AI-Facing Contract

The following should not survive in the new AI-facing shape:

- top-level `operations`
- `contract_view` / `index_view` nested inside a generic operation bag
- scan-style RPC discovery inside `contract_view`
- `bind_from: "$input.*"` self-bindings
- unnecessary read/output presentation residue

## Orca Migration Target

Target file:

- `orca_whirlpool.agent.runtime.json`

Planned shape:

- `protocol`
- `navigation`
  - `discover_pool_for_pair`
  - `inspect_pool`
  - `quote_swap_exact_in`
  - `swap_exact_in`
- `reads.contract`
  - `pool_snapshot`
- `reads.index`
  - `list_pools`
  - `resolve_pool`
  - `trade_feed`
  - `market_cap_series`
- `computes`
  - `quote_exact_in`
- `executions`
  - `swap_exact_in`

Important cut:

- remove quote behavior from `swap_exact_in`
- make quote a first-class compute capability

## Pump AMM Migration Target

Target file:

- `pump_amm.agent.runtime.json`

Planned shape:

- `protocol`
- `navigation`
  - `discover_pool_for_mint`
  - `inspect_pool`
  - `preview_buy`
  - `preview_sell`
  - `buy`
  - `sell`
- `reads.contract`
  - only targeted pool reads if actually needed
- `reads.index`
  - `list_tokens`
  - `resolve_pool`
  - `pool_snapshot`
  - `ranked_active_tokens`
  - `trade_feed`
  - `market_cap_series`
- `computes`
  - buy preview
  - sell preview
- `executions`
  - `buy`
  - `sell`

Important cuts:

- remove noisy self-bindings
- keep discovery in `reads.index`
- do not use `reads.contract` for large scans

## Runtime / Backend Refactor Plan

### Phase 1. Add New Schema

Add:

- `schemas/solana_agent_runtime.schema.v1.json`

Do not add compatibility.

### Phase 2. Add New Loaders

In `apppack-runtime`, add direct loaders for:

- `loadAgentRuntimePack`
- `listContractReads`
- `listIndexReads`
- `listComputes`
- `listExecutions`

These should not read the old `operations` bag.

### Phase 3. Add New Runners

In `apppack-runtime`, add:

- `runContractRead`
- `runIndexRead`
- `runCompute`
- `draftExecution`

Each runner should operate only on its own section of the spec.

### Phase 4. Wallet Cut

Replace the old UI assumptions with:

- `Contract Reads`
- `Index Reads`
- `Computes`
- `Executions`

The wallet should no longer interpret a generic `operations` bag.

### Phase 5. Backend Cut

In `view-service`:

- `reads.contract` routes to the targeted read service
- `reads.index` routes to canonical/discovery read service
- `computes` becomes an explicit compute endpoint or runtime path

### Phase 6. Delete The Old AI-Facing Runtime Shape

Once Orca and Pump are migrated:

- stop using runtime `operations` for AI-facing paths
- stop using `contract_view`
- stop using `index_view`
- stop using `read_output` in the old shape for agent surfaces

The old `declarative_decoder_runtime` remains only as an indexing spec until indexing itself gets a dedicated schema split.

## Hard Rules

1. `reads.contract` must be targeted.
2. `reads.index` owns discovery/search/listing/feed/ranking.
3. `computes` owns quotes and previews.
4. `executions` owns tx draft/simulate/submit.
5. `navigation` explains the path an AI should take between those capabilities.
6. No protocol-specific MCP should be necessary for normal AI interaction.

## Execution Order

1. Create `solana_agent_runtime.schema.v1.json`
2. Implement runtime pack loader and listing APIs
3. Migrate Orca to the new agent runtime file
4. Wire wallet tabs to the new sections
5. Wire backend read/compute routing to the new sections
6. Migrate Pump AMM
7. Remove the old AI-facing `operations` contract from active paths

## Definition Of Done

We are done when an AI can, from the spec alone:

- discover the right entity
- read protocol state
- read indexed state
- compute a quote or preview
- draft a transaction
- simulate it
- submit it

without protocol-specific MCP glue and without hidden imperative adapters.
