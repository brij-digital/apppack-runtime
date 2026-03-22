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
