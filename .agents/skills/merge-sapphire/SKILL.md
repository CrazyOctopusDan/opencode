---
name: merge-sapphire
description: Sync upstream dev into the Sapphire/TravelSky dev-sapphire branch using the current OpenCode architecture, port enterprise behavior, and verify login, model access, reporting, and Windows/Linux CLI and Desktop packaging.
---

# Merge Sapphire

Use for upstream updates to `dev-sapphire`. Read the repository's current `AGENTS.md` and [enterprise baseline](../../../travelsky/changes-baseline.md). The [v2 migration record](../../../travelsky/migration-v2.md) is historical evidence, not a permanent upstream version or test-count requirement.

## Integration policy

- Prefer the current upstream architecture; adapt the documented enterprise behavior to it. The baseline describes outcomes and current entrypoints, not files or Provider nesting that must survive unchanged.
- Do not restore the removed legacy runner, CLI, auth contexts, or unused tracing implementation to satisfy an obsolete checklist. When upstream replaces an entrypoint, update its baseline mapping and validation together.
- Company login and local OpenCode server authentication are separate. Preserve native Desktop automatic connection and internal server authentication. Follow the baseline's login UI scope; do not introduce QR/pairing/setup steps into company login.
- A normal update is a semantic merge. The v2 migration's history-only `ours` merge was a one-time integration; never repeat it as the routine update strategy or use whole-tree replacement to hide conflicts.

## Resolve the source and merge

1. Inspect status, branch, remotes, worktrees, and the source/target SHAs. Preserve unrelated user changes; use an isolated worktree if necessary. Do not reset or silently stash user work.
2. If asked to pull remote dev, fetch the configured source remote (normally `origin`), then fast-forward local `dev` to `origin/dev`. If `dev` diverged, inspect the commits and resolve the intended source before merging; do not overwrite it. If asked only to merge an already-synced local `dev`, use that ref and record its SHA.
3. Switch to `dev-sapphire` and merge the resolved source. In a normal merge on that branch, ours is Sapphire and theirs is upstream. Inspect base/ours/theirs for business conflicts; a clean merge still needs behavior checks.
4. Use upstream `bun.lock` as the starting dependency graph, then reconcile the merged manifests and enterprise dependencies (currently Core's `sm-crypto`) with Bun. Do not discard enterprise dependencies by accepting the lockfile alone. Review the resulting diff and verify a frozen install is consistent.
5. Regenerate Client from `packages/client` with `bun run generate` if public Protocol/Server HttpApi changed. Never resolve generated files independently of their source.
6. Update the enterprise baseline when behavior, entrypoints, verification commands, or supported artifacts change. Record intentional removals/replacements and verification gaps. Do not rewrite the historical migration results as if newly verified.

## Verification

- Compare `bun --version` with root `package.json`'s `packageManager`; use the required version before install/check/build.
- Run `git diff --check`, inspect unresolved paths and conflict markers, then `bun run check` at the repository root. Tests run from package directories. Use the baseline's focused tests and add connected upstream tests for changed integration points.
- Before writing/changing tests, read the matching `.opencode/skills` test skill. For package iteration use `bun typecheck`; when Bun and TypeScript disagree, follow current `AGENTS.md` and `typecheck:tsc`.
- If auth/shell/connection UI changed, verify unauthenticated startup, successful login, logout/expiry, reconnection, and input/button alignment. Use isolated fixtures for synthetic acceptance. Follow `AGENTS.md` for live TUI and Desktop diagnostics; do not replace the user's live server to run a smoke test.
- Check the actual metric payload `toolVersion` in `packages/core/src/travelsky/metric.ts` against the source release and merged root/Core/CLI versions. Keep it a release short version within the backend's 15-character limit, without a dev suffix; retain empty `ideVersion`. Run its version regression test. Do not truncate a version that exceeds the contract.

## Packaging audit

Even for an already-up-to-date merge, inspect the exact source commit's `.github/workflows/release.yml`, `.github/actions/setup-bun/action.yml`, `packages/cli/script/build.ts`, and Desktop `script/build.ts` / `script/pack.ts`. Follow their referenced configuration when it changes. Compare with both fork `build-desktop-*.yml` workflows; do not look for the removed `publish.yml` or legacy CLI builder.

Check all four artifact families in the baseline, supported targets, archive contents/permissions, shared CLI/Desktop release version, Bun/Node requirements, and build-to-upload paths. Desktop must consume its matching compiled CLI. Missing artifacts must fail the workflow. Preserve fork triggers, manual dispatch, and no signing or release publishing unless requested. Validate YAML and dependencies after edits.

## Completion

Report source SHA/version, target branch/HEAD, conflicts and semantic adaptations, lockfile handling, baseline updates, metric version alignment, and verification results. Distinguish local/static checks, synthetic browser tests, actual Windows/Linux CI/artifacts, and live company acceptance. State dirty/committed/pushed status. A merge request does not by itself authorize a remote push or publication.
