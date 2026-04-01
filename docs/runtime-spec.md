# Runtime Spec V1

This document describes the current `solana-agent-runtime.v1` contract.

It is the smallest layer that still exists after moving instruction-level truth into Codama and indexed-read semantics into the indexing spec.

## What lives where

For each protocol, AppPack now has three declarative artifacts:

1. `*.codama.json`
- instruction-level source of truth
- instruction accounts
- signers
- fixed/default accounts
- PDA-backed defaults when declared in Codama

2. `*.indexing.json`
- indexed reads
- discovery
- feeds
- series
- ranking

3. `*.runtime.json`
- deterministic compute
- deterministic write preparation
- small transaction-envelope logic around writes

The runtime spec does **not** redefine the instruction schema.
It assumes Codama already owns that.

## Where program-specific logic lives

Program-specific runtime logic lives in the protocol runtime file:

- `public/idl/<protocol>.runtime.json` in the authoring repo

Examples:
- `orca_whirlpool.runtime.json`
- `pump_amm.runtime.json`
- `pump_core.runtime.json`

This file is authored and maintained by the protocol pack maintainer.

What the maintainer provides there:
- named `computes`
- named `contract_writes`
- the exact inputs each operation accepts
- the extra runtime context that still needs to be resolved
- the deterministic compute steps needed to derive intermediate values
- the mapping from those values into instruction args/accounts
- optional `pre` / `post` transaction-envelope instructions

What the maintainer does **not** need to restate there:
- the raw instruction account schema
- signer metadata
- fixed/default accounts already declared in Codama
- indexed view semantics

## Runtime file shape

Current top-level shape:

```json
{
  "$schema": "/idl/solana_agent_runtime.schema.v1.json",
  "schema": "solana-agent-runtime.v1",
  "computes": {
    "...": {}
  },
  "contract_writes": {
    "...": {}
  }
}
```

That is intentionally small.

## Computes

A `compute` operation is a deterministic protocol-specific calculation.

Typical uses:
- quote preview
- threshold derivation
- PDA list derivation
- list filtering / selection
- typed output for UI, backend, or agent use

Current shape:

```json
{
  "instruction": "swap_v2",
  "inputs": {
    "token_in_mint": { "type": "token_mint", "required": true },
    "token_out_mint": { "type": "token_mint", "required": true },
    "amount_in": { "type": "u64", "required": true },
    "slippage_bps": { "type": "u16", "required": true },
    "whirlpool": { "type": "pubkey", "required": true }
  },
  "resolve": [],
  "compute": [],
  "read_output": {}
}
```

### `resolve`

`resolve` loads only the extra runtime context still needed outside Codama.

Current live kinds:
- `wallet_pubkey`
- `decode_account`
- `account_owner`
- `token_account_balance`
- `token_supply`
- `ata`
- `pda`

Example:

```json
[
  {
    "name": "wallet",
    "kind": "wallet_pubkey"
  },
  {
    "name": "whirlpool_data",
    "kind": "decode_account",
    "address": "$input.whirlpool",
    "account_type": "Whirlpool"
  }
]
```

### `compute`

`compute` is a small deterministic expression language.

It is used to derive values such as:
- `a_to_b`
- tick array addresses
- `estimated_out`
- `minimum_out`

Example:

```json
[
  {
    "name": "a_to_b",
    "kind": "compare.equals",
    "left": "$whirlpool_data.token_mint_a",
    "right": "$input.token_in_mint"
  },
  {
    "name": "estimated_out",
    "kind": "coalesce",
    "values": ["$estimated_out_effective"]
  },
  {
    "name": "minimum_out",
    "kind": "coalesce",
    "values": ["$other_amount_threshold"]
  }
]
```

### `read_output`

`read_output` declares the typed output contract of the operation.

That is what makes a compute usable by:
- the backend
- the UI
- an agent
- a runner

## Contract writes

A `contract_write` prepares one concrete instruction call using:
- Codama for the instruction schema
- runtime inputs
- resolved values
- computed values

Current shape:

```json
{
  "instruction": "swap_v2",
  "inputs": {},
  "resolve": [],
  "compute": [],
  "args": {},
  "accounts": {},
  "remaining_accounts": [],
  "pre": [],
  "post": []
}
```

### `args`

`args` maps concrete scalar values into the instruction arguments.

Example:

```json
{
  "amount": "$input.amount_in",
  "other_amount_threshold": "$other_amount_threshold",
  "sqrt_price_limit": "0",
  "amount_specified_is_input": true,
  "a_to_b": "$a_to_b",
  "remaining_accounts_info": null
}
```

### `accounts`

`accounts` maps concrete pubkeys into the named instruction accounts.

These bindings only exist for values that still need materialization at runtime.
Anything already implied by Codama defaults should stay in Codama instead.

Example:

```json
{
  "whirlpool": "$input.whirlpool",
  "token_mint_a": "$whirlpool_data.token_mint_a",
  "token_mint_b": "$whirlpool_data.token_mint_b",
  "tick_array0": "$tick_arrays.0",
  "tick_array1": "$tick_arrays.1",
  "tick_array2": "$tick_arrays.2"
}
```

### `pre` / `post`

This is the remaining transaction-envelope layer.

Typical uses:
- create ATA if needed
- wrap native SOL
- sync native
- close temporary WSOL account

Example:

```json
[
  {
    "kind": "spl_ata_create_idempotent",
    "payer": "$wallet",
    "ata": "$instruction_accounts.token_owner_account_a",
    "owner": "$wallet",
    "mint": "$whirlpool_data.token_mint_a"
  }
]
```

This is also the area that maps most naturally to future Codama instruction-plan support.

## Concrete Orca example

In the Orca pack:

- `quote_exact_in`
  - decodes the `Whirlpool`
  - computes direction, tick arrays, `estimated_out`, `minimum_out`
  - returns a typed quote result

- `swap_exact_in`
  - reuses the same deterministic logic
  - fills instruction args
  - materializes dynamic accounts
  - adds ATA / WSOL envelope instructions when needed

In other words:
- Codama says what `swap_v2` is
- the runtime spec says how this application prepares a usable `swap_v2`

## Authoring rule of thumb

Put logic in Codama when it is:
- instruction structure
- account metadata
- signer metadata
- fixed/default account resolution
- PDA-backed defaults

Put logic in the runtime spec when it is:
- deterministic protocol-specific compute
- dynamic value materialization for a write
- small transaction-envelope logic around a write

Keep logic out of the runtime spec when it belongs in the indexing spec:
- discovery
- search
- feeds
- ranking
- series

## Why this split exists

This split keeps the runtime layer small and explicit:
- Codama remains the instruction source of truth
- indexing remains the read/discovery source of truth
- runtime remains a narrow deterministic execution layer on top
