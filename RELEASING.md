# Releasing `@brij-digital/apppack-runtime`

This package is published through GitHub Actions from tags on `main`.

## Release Flow

1. Make the runtime change.
2. Update `package.json` to the new version.
3. Commit and push that change to `main`.
4. Create a matching git tag in the form `vX.Y.Z`.
5. Push the tag.
6. Wait for the `Publish Package` workflow to complete.
7. Update downstream consumers to the published version and run their CI.

## Required Rules

- The git tag must match `package.json` exactly.
- Do not publish manually from a laptop unless CI is unavailable.
- Do not re-use an existing version number.
- Update downstream consumers deliberately after publish.

## Example

If `package.json` is changed to `0.1.10`, the release tag must be:

```bash
git tag v0.1.10
git push origin v0.1.10
```

The workflow will reject `v0.1.11` if `package.json` still says `0.1.10`.

## Shared Schema Rule

If anything under `schemas/` changes:

1. run `npm run schemas:check`
2. sync downstream schema copies
3. make sure downstream drift checks pass before release

## Shared Contract Change Order

When a shared contract changes, use this order:

1. update schema files in [`schemas/`](/home/ubuntu/src/apppack-runtime/schemas)
2. update runtime validation/tests if needed
3. release a new runtime version
4. update wallet pack generator or pack source if needed
5. regenerate wallet outputs
6. sync downstream consumers
7. run downstream drift/smoke checks
8. only then update backend/frontend runtime code that depends on the new contract

Do not edit downstream copies first and backfill ownership later.

## Breaking Change Rule

If a shared schema or shared contract changes in a breaking way:

1. bump the runtime version deliberately
2. update downstream consumers deliberately
3. do not rely on silent compatibility through copied artifacts
