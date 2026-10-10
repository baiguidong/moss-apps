# 应用构建

Create and iterate Moss Apps in an ordinary local Agent conversation. The App contributes five tools; Moss Core provides developer contracts, source snapshots, builds, isolated previews and installation receipts. Skill directories can be supplied as conversion input without loading a Skill Assistant.

Requires the latest Moss Host API with `moss.apps/v1` authoring methods and developer SDK export. During unpublished Host 3.0.0 development, method availability and contract/SDK hashes identify the required snapshot.

Run `bun run check`, `bun run test`, and `bun run build` from this directory. Package with `bun run package -- --app moss.app-builder --skip-build` at the repository root. The initial package is built by CLI; an installed Builder is not required.

This workspace uses an uncommitted Core SDK snapshot recorded in `assets/core-sdk-provenance.json`. Builds verify its SHA-256 against `vendor/moss-core`. To synchronize an intentional Core change, run `node scripts/sync-core-sdk.mjs` with `MOSS_CORE_ROOT` pointing to the source checkout, then `node scripts/generate-tool-schemas.mjs`; review the provenance and generated schema changes before building. This is a development snapshot, not a published submodule revision.

Run `test:browser`, `test:desktop`, and `test:agent` for real Electron/ordinary-Agent coverage. The Agent test requires `MOSS_BUILDER_AGENT_SETTINGS` pointing to model settings; only the text-model configuration is copied to a temporary profile. `MOSS_BUILDER_TEST_CONVERSION=1` tests local Skill input; `MOSS_BUILDER_TEST_EXTERNAL=1` tests Backend conversion and a local HTTP service with success/missing-credential/unavailable-service cases. On macOS, `MOSS_CORE_EXECUTABLE=/path/to/Moss.app/Contents/MacOS/Moss` tests a copy of the installed Core with development repository reads denied.

Sanitized local evidence is in `artifacts/moss.app-builder/verification/0.1.0/` at the repository root. Full implementation, verification limits and open acceptance items are documented in the adjacent Core repository at `ui/docs/app-builder-app-implementation.md`. Only Apple Silicon macOS has been exercised; this package has not been publicly released.
