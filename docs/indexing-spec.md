# Indexing Spec V1 Reference

This page documents the current `declarative-decoder-runtime.v1` contract.

It is the source of truth for:
- decoder artifacts
- ingest sources
- match rules
- ingest pipelines
- projections
- indexed read operations (`operations.*.index_view`)

It does **not** describe:
- Codama instruction execution
- runtime write preparation
- action runner flows

## Top-level shape

```json
{
  "$schema": "/idl/declarative_decoder_runtime.schema.v1.json",
  "schema": "declarative-decoder-runtime.v1",
  "protocolId": "pump-amm-mainnet",
  "decoderArtifacts": {},
  "sources": {},
  "matchRules": [],
  "pipelines": {},
  "projectionSpecs": {},
  "operations": {}
}
```

Attributes:
- `$schema`
  - optional
  - JSON schema path
- `schema`
  - required
  - must be `declarative-decoder-runtime.v1`
- `version`
  - optional
  - string
- `protocolId`
  - required
  - protocol id
- `label`
  - optional
  - human label
- `programId`
  - optional
  - program id or template
- `decoderArtifacts`
  - required
  - map of artifact id -> `decoderArtifactSpec`
- `sources`
  - required
  - map of source id -> `sourceSpec`
- `matchRules`
  - required
  - array of `matchRuleSpec`
- `pipelines`
  - required
  - map of pipeline id -> `pipelineSpec`
- `projectionSpecs`
  - optional
  - map of projection id -> `projectionSpec`
- `operations`
  - optional
  - map of operation id -> `operationSpec`

## `decoderArtifactSpec`

Defines how decoded program data enters the ingest runtime.

Attributes:
- `kind`
  - required
  - `generated_idl_decoder` or `precompiled_decoder`
- `family`
  - optional
  - `anchor`, `codama`, or `custom`
- `codamaPath`
  - required when `family = codama`
  - path to Codama artifact
- `artifact`
  - required
  - artifact id used by the ingest runtime
- `entrypoint`
  - optional
  - custom decoder entrypoint
- `notes`
  - optional
  - string

## `sourceSpec`

Defines where decoded updates come from.

Attributes:
- `kind`
  - required
  - one of:
    - `rpc_transaction_crawler`
    - `rpc_block_subscribe`
    - `rpc_program_subscribe`
    - `rpc_account_snapshot`
    - `yellowstone_grpc`
    - `custom`
- `programId`
  - optional
  - program id or template
- `commitment`
  - optional
  - `processed`, `confirmed`, or `finalized`
- `decoderRef`
  - required
  - decoder artifact id
- `decodeTargets`
  - optional
  - array of:
    - `instruction`
    - `log_event`
    - `account`
    - `transaction`
- `filters`
  - optional
  - source-specific filter object
- `cursor`
  - optional
  - `cursorSpec`

### `cursorSpec`

Attributes:
- `kind`
  - optional
  - `signature`, `slot`, `time`, or `opaque`
- `field`
  - optional
  - field used as cursor

### `sourceTargetsSpec`

Used inside `sources[*].filters.targetsFrom`.

Attributes:
- `kind`
  - required
  - `missing_state_from_records`
  - `incomplete_state_from_state`
  - `incomplete_state_from_records`
- `stateRecordName`
  - required
  - state record name
- `missingFields`
  - optional
  - array of missing state fields
- `recordNames`
  - optional
  - array of driving record names
- `addressField`
  - optional
  - `resource_id` or `subject_id`
- `lookbackMinutes`
  - optional
  - integer
- `limit`
  - optional
  - integer

## `matchRuleSpec`

Routes a decoded update from a source into a named pipeline.

Attributes:
- `source`
  - required
  - source id
- `match`
  - required
  - `matchPredicateSpec`
- `pipeline`
  - required
  - pipeline id

### `matchPredicateSpec`

Attributes:
- `decodedType`
  - required
  - `instruction`, `event`, `account`, or `transaction`
- `name`
  - optional
  - generic decoded name
- `instruction`
  - optional
  - instruction name
- `event`
  - optional
  - event name
- `account`
  - optional
  - account name
- `where`
  - optional
  - object of additional match predicates

## `pipelineSpec`

Transforms one matched update into canonical records/state.

Attributes:
- `extract`
  - optional
  - object of named extracted fields
- `resolve`
  - optional
  - array of `resolveStepSpec`
- `compute`
  - optional
  - array of `computeStepSpec`
- `emit`
  - optional
  - `emitSpec`

### `resolveStepSpec`

Attributes:
- `name`
  - required
  - output name
- `resolve`
  - required
  - one of:
    - `rpc.token_supply`
    - `rpc.account_info`
    - `rpc.token_account_balance`
    - `state.lookup`
    - `resource.lookup`
    - `custom`
- `required`
  - optional
  - boolean
- `requiredFields`
  - optional
  - array of field names
- additional properties
  - allowed
  - resolver-specific arguments such as `mint`, `recordName`, `subjectId`, `resourceId`

### `computeStepSpec`

Attributes:
- `name`
  - required
  - output name
- `compute`
  - required
  - one of:
    - `math.amount_ui`
    - `math.safe_div`
    - `math.mul`
    - `math.add`
    - `math.sub`
    - `math.avg`
    - `compare.gt`
    - `compare.gte`
    - `compare.lt`
    - `compare.eq`
    - `logic.if`
    - `string.concat`
    - `coalesce`
    - `wasm`
- `module`
  - optional
  - wasm module name
- `entrypoint`
  - optional
  - wasm entrypoint name
- additional properties
  - allowed
  - compute-specific arguments such as `amount`, `decimals`, `dividend`, `divisor`, `values`

## `emitSpec`

Defines what the pipeline writes into canonical storage.

Attributes:
- `record`
  - optional
  - `recordEmitSpec`
- `state`
  - optional
  - `stateEmitSpec`

At least one of `record` or `state` is required.

### `recordEmitSpec`

Attributes:
- `recordKind`
  - required
  - string
- `recordName`
  - required
  - string
- `subjectId`
  - required
  - template
- `resourceId`
  - optional
  - template
- `participantId`
  - optional
  - template
- `signature`
  - optional
  - template
- `slot`
  - optional
  - template
- `eventTime`
  - optional
  - template
- `payload`
  - required
  - object payload

### `stateEmitSpec`

Same shape as `recordEmitSpec`, except there is no `participantId`.

## `projectionSpec`

Defines canonical materializations such as feeds, rankings, series, snapshots, and context views.

Attributes:
- `projectionKind`
  - required
  - `series`, `feed`, `ranking`, `snapshot`, or `context`
- `source`
  - required
  - `projectionSourceSpec`
- `bucket`
  - optional
  - time bucket string
- `groupBy`
  - optional
  - array of grouping fields
- `timeField`
  - optional
  - time field name
- `aggregations`
  - optional
  - array of `projectionAggregationSpec`
- `sortBy`
  - optional
  - array of `sortSpec`

### `projectionSourceSpec`

Attributes:
- `canonicalSource`
  - required
  - `indexed_idl_records`, `indexed_idl_state`, or `indexed_series_1m`
- `protocolId`
  - required
  - protocol id
- `recordKind`
  - optional
  - string
- `recordName`
  - optional
  - string or string array
- `seriesId`
  - optional
  - string
- `subjectInput`
  - optional
  - input name
- `resourceInput`
  - optional
  - input name
- `timeField`
  - optional
  - field name

### `projectionAggregationSpec`

Attributes:
- `name`
  - required
  - output field name
- `field`
  - required
  - source field
- `fn`
  - required
  - `first`, `last`, `min`, `max`, `sum`, `avg`, `count`, or `count_distinct`

### `sortSpec`

Attributes:
- `field`
  - required
  - field name
- `order`
  - required
  - `asc` or `desc`

## `operations.*.index_view`

This is the part of the indexing spec that now owns indexed read/discovery surfaces.

### `canonicalViewSpec`

Attributes:
- `source`
  - required
  - `indexed_idl_records`, `indexed_idl_state`, or `indexed_series_1m`
- `protocol_id`
  - required
  - protocol id
- `record_kind`
  - optional
  - canonical record kind
- `record_name`
  - optional
  - string or string array
- `series_id`
  - optional
  - series id
- `subject_input`
  - optional
  - input key used as subject
- `resource_input`
  - optional
  - input key used as resource
- `subject_field`
  - optional
  - canonical field to filter by subject
- `resource_field`
  - optional
  - canonical field to filter by resource
- `time_field`
  - optional
  - canonical time field
- `notes`
  - optional
  - string

### `viewProjectionSpec`

Attributes:
- `projection_kind`
  - required
  - `snapshot`, `feed`, `series`, `ranking`, or `context`
- `source_operation`
  - optional
  - operation id
- `bucket`
  - optional
  - time bucket
- `group_by`
  - optional
  - array of field names
- `aggregations`
  - optional
  - array of `projectionAggregationSpec`
- `sort_by`
  - optional
  - array of `sortSpec`

### `indexViewSpec`

Attributes:
- `kind`
  - required
  - `search`, `account`, `feed`, `series`, `ranking`, or `context`
- `inputs`
  - optional
  - map of input name -> `runtimeInputSpec`
- `read_output`
  - optional
  - `readOutputSpec`
- `source_kind`
  - optional
  - source mode
- `freshness`
  - optional
  - freshness config
- `entity_type`
  - optional
  - string
- `title`
  - optional
  - string
- `description`
  - optional
  - string
- `sync_disabled`
  - optional
  - boolean
- `bootstrap`
  - optional
  - bootstrap config
- `refresh`
  - optional
  - refresh config
- `query`
  - optional
  - query config
- `target`
  - optional
  - target config
- `select`
  - optional
  - selection config
- `canonical`
  - optional
  - `canonicalViewSpec`
- `projection`
  - optional
  - `viewProjectionSpec`

Rules:
- if `source_kind = account_changes`
  - `bootstrap` and `query` are required
- otherwise
  - `canonical` and `projection` are required

### `contractViewSpec`

Attributes:
- `kind`
  - required
  - currently only `account`
- `source_kind`
  - optional
- `freshness`
  - optional
- `entity_type`
  - optional
- `title`
  - optional
- `description`
  - optional
- `bootstrap`
  - optional
- `refresh`
  - optional
- `query`
  - optional
- `target`
  - optional
- `select`
  - optional

### `operationSpec`

Attributes:
- `contract_view`
  - optional
  - `contractViewSpec`
- `index_view`
  - optional
  - `indexViewSpec`

## Pump AMM example

Minimal shape from `pump_amm.indexing.json`:

```json
{
  "sources": {
    "pump_swap_crawler": {
      "kind": "rpc_transaction_crawler",
      "decoderRef": "pump_swap",
      "decodeTargets": ["instruction", "log_event"]
    }
  },
  "matchRules": [
    {
      "source": "pump_swap_crawler",
      "match": { "decodedType": "event", "name": "BuyEvent" },
      "pipeline": "trade_buy"
    }
  ],
  "pipelines": {
    "trade_buy": {
      "resolve": [
        {
          "name": "poolMeta",
          "resolve": "state.lookup",
          "recordName": "PoolMetadata",
          "subjectId": "$decoded.pool",
          "required": true
        }
      ],
      "compute": [
        {
          "name": "priceQuote",
          "compute": "math.safe_div",
          "dividend": "$quoteAmountUi",
          "divisor": "$baseAmountUi"
        }
      ],
      "emit": {
        "record": {
          "recordKind": "event",
          "recordName": "BuyEvent",
          "subjectId": "$ctx.mint",
          "resourceId": "$ctx.pool",
          "payload": {}
        }
      }
    }
  }
}
```

## Useful links

- schema:
  - `/idl/declarative_decoder_runtime.schema.v1.json`
- pump amm indexing:
  - `/idl/pump_amm.indexing.json`
- orca indexing:
  - `/idl/orca_whirlpool.indexing.json`
