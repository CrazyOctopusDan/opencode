---
name: merge-sapphire
description: Merge local dev into dev-sapphire for the Sapphire/TravelSky OpenCode fork, resolving conflicts with travelsky/changes-baseline.md and travelsky/baseline-checklists/*.md, preserving secondary-development behavior, preferring dev bun.lock, and verifying CLI and desktop safety.
---

# Merge Sapphire

Use this skill when merging source branch `dev` into the secondary-development branch `dev-sapphire` after upstream source code has already been synced into local `dev`.

## Hard Rules

- Source branch: `dev`.
- Target branch: `dev-sapphire`.
- On `dev-sapphire`, `git merge dev` means `ours` is `dev-sapphire` and `theirs` is `dev`.
- Read `travelsky/changes-baseline.md` before resolving any business conflict.
- Read every `travelsky/baseline-checklists/*.md` file if the directory exists.
- Preserve `travelsky/changes-baseline.md` and checklist files during a merge, except for the metric tool-version alignment described below; other edits require an explicit user request.
- Resolve `bun.lock` conflicts with the source branch version from `dev` (`theirs`).
- Do not resolve business-code conflicts by whole-file overwrite unless the file is generated or both sides are mechanically equivalent.
- Preserve Sapphire/TravelSky behavior first, then integrate upstream changes around it.
- Keep CLI and desktop behavior stable. If either side is touched, verify that side explicitly.
- Preserve app provider ordering: `ServerProvider` must wrap `AuthProvider`, and `AuthProvider` must wrap `GlobalProvider`. `GlobalProvider` eagerly creates server SDK contexts, and those contexts call `useAuth()`. If `GlobalProvider` is outside `AuthProvider`, desktop startup fails with `Auth context must be used within a context provider`.
- After every merge, compare local `bun --version` with the root `package.json` `packageManager` Bun version. If local Bun is older, run `bun upgrade` and recheck.
- After every merge, inspect upstream `.github/workflows/publish.yml` for Windows/Linux CLI and desktop packaging changes. If upstream packaging commands, artifacts, targets, Node version, setup-bun usage, prepare/build/package steps, or required environment variables changed, update `.github/workflows/build-desktop-windows.yml` and `.github/workflows/build-desktop-linux.yml` to match the fork's equivalent packaging flow.

## Start

Read context:

```bash
sed -n '1,220p' AGENTS.md
sed -n '1,260p' travelsky/changes-baseline.md
find travelsky -path 'travelsky/baseline-checklists/*.md' -type f -print
```

Inspect state:

```bash
git status --short
git branch --show-current
git rev-parse --verify dev
git rev-parse --verify dev-sapphire
```

If the worktree has user changes, inspect them before merging. Do not reset, checkout, clean, or stash user work without explicit user approval. Continue only when dirty files are unrelated or the user has approved the handling.

Create a mental pre-merge baseline from:

- files listed in `travelsky/changes-baseline.md`;
- files listed in `travelsky/baseline-checklists/*.md`;
- current tests that protect those files.

## Merge

```bash
git switch dev-sapphire
git merge dev
```

If the merge completes without conflicts, still run the protection checklist. Clean merges can still break Sapphire behavior.

## Conflict Workflow

List conflicts:

```bash
git diff --name-only --diff-filter=U
git status --short
```

For each conflict, inspect all useful views:

```bash
git diff --ours -- path/to/file
git diff --theirs -- path/to/file
git show :1:path/to/file
git show :2:path/to/file
git show :3:path/to/file
```

Resolve by class:

- `bun.lock`: accept stage 3 (`dev`) and stage the file.
- Baseline/checklist files: preserve every documented invariant and verification point.
- CLI login/provider/model files: preserve local token storage, expiry semantics, Bearer header injection, TravelSky-only provider behavior, and `ensureLogin` before `tui(...)`.
- Metric files: preserve run-loop completion timing, same-origin Tempo host/cookie reuse, timeout tolerance, and `token`/`tool`/`file_change`/`answer_code` separation.
- Tests: preserve or update tests so each baseline/checklist invariant remains guarded.
- Desktop files: prefer upstream unless a compatibility change is required by a preserved Sapphire behavior. Do not add new desktop-specific Sapphire behavior unless already documented.
- App provider/router files: preserve `ServerProvider > AuthProvider > GlobalProvider` in `packages/app/src/app.tsx`. Do not accept upstream/provider refactors that move `GlobalProvider` outside `AuthProvider`; adapt the surrounding route/shell changes around that invariant.
- Generated SDK files: resolve the source file first, then regenerate with `./packages/sdk/js/script/build.ts` when OpenAPI or SDK source changed.

After each group, stage only resolved files and recheck:

```bash
git diff --name-only --diff-filter=U
```

Stop and reassess before continuing if upstream substantially rewrote authentication, provider discovery, TUI startup, session lifecycle, snapshot diffing, or Tempo reporting. These areas are behavior-critical and need semantic integration, not marker cleanup.

## Required Audit

Before calling the merge complete, build a short audit note for yourself and verify:

- every file in `travelsky/changes-baseline.md` that exists in the repo still satisfies its conflict strategy;
- every checklist item in `travelsky/baseline-checklists/*.md` is preserved or has an explicit reason it no longer applies;
- `bun.lock` came from `dev` if it conflicted;
- no conflict markers remain;
- no baseline/checklist file was changed accidentally;
- CLI touched files have focused tests or typecheck coverage;
- desktop touched files have the nearest available package verification;
- app provider/router touched files preserve `ServerProvider > AuthProvider > GlobalProvider`;
- Bun version check result;
- whether `.github/workflows/build-desktop-windows.yml` and `.github/workflows/build-desktop-linux.yml` were already aligned with `.github/workflows/publish.yml`, or what packaging workflow changes were made.

Commands:

```bash
rg -n '<<<<<<<|=======|>>>>>>>' .
git diff --check
```

## Bun and Packaging Workflow Audit

Always run this after the merge conflict audit and before the final response, including an already-up-to-date merge. An unchanged upstream workflow does not prove the fork delivery is complete.

Check the required Bun version:

```bash
bun --version
node -p "require('./package.json').packageManager"
```

If `bun --version` is lower than the version in `packageManager`, upgrade and verify:

```bash
bun upgrade
bun --version
```

Read `.github/workflows/publish.yml` from the exact source `dev` commit being merged (for example, `git show dev:.github/workflows/publish.yml`) and compare it with the fork workflows. Follow referenced build scripts and packaging configuration; do not infer deliverables from job names alone.

Inspect the merged workflow files:

```bash
sed -n '70,470p' .github/workflows/publish.yml
sed -n '1,200p' .github/workflows/build-desktop-windows.yml
sed -n '1,220p' .github/workflows/build-desktop-linux.yml
```

Compare these `publish.yml` areas against the fork workflows:

- `build-cli`: runner, `setup-bun`, build command, artifact names, and Windows/Linux artifact paths.
- `sign-cli-windows`: Windows CLI artifact layout, signing path list, repack commands, and signed artifact names. If the fork does not sign, still keep input/output artifact names compatible with downstream desktop packaging.
- `build-electron` Windows/Linux matrix entries: host OS, `target`, `platform_flag`, `bun_install_flags`, Node version, apt dependencies, cache key shape, and `OPENCODE_CLI_ARTIFACT` / `RUST_TARGET` values.
- desktop steps: `bun ./scripts/prepare.ts`, `bun run build`, `npx electron-builder ... --config electron-builder.config.ts`, timeout, `OPENCODE_CHANNEL`, and uploaded artifact path/name.

Update `.github/workflows/build-desktop-windows.yml` or `.github/workflows/build-desktop-linux.yml` when the fork workflows drift from the official Windows/Linux packaging flow or omit a required deliverable. Keep fork-specific differences intentional: `dev-sapphire` trigger, manual dispatch, no release publishing, and no signing unless explicitly required.

The fork must produce **four independently downloadable artifact families**:

| Workflow | Required outputs |
| --- | --- |
| `build-desktop-windows.yml` | Windows Desktop installers and standalone Windows CLI archives |
| `build-desktop-linux.yml` | Linux Desktop installers and standalone Linux CLI archives |

- Trace each family from build command through packaging to `upload-artifact`. Desktop Node sidecars, embedded server files, and CLI binaries downloaded only for a development channel do not count as standalone CLI delivery.
- Preserve Desktop x64/arm64 targets. For CLI, preserve the Windows/Linux targets supported by the upstream traditional `packages/opencode/script/build.ts`, including baseline and Linux musl variants. The separate preview `packages/cli` executable is not a replacement for the TravelSky-enabled CLI unless its enterprise behavior has been explicitly migrated and verified.
- Use the same version job output for CLI and Desktop and retain the metric tool-version audit. Reuse the upstream build script rather than duplicating its bundling logic. Its current full cross-platform build may run in each OS workflow; upload only that workflow's platform archives.
- Keep CLI and Desktop jobs independently runnable after version resolution. Official-repository conditions such as `github.repository == 'anomalyco/opencode'` must not prevent fork build jobs from running.
- Archive the complete CLI `bin` contents as Windows `.zip` and Linux `.tar.gz`, preserving Linux executable permissions. Check expected binaries before archiving and set `if-no-files-found: error` on all four artifact families; missing artifacts must fail the workflow.
- Validate YAML, job dependencies, version propagation, target/archive names, and packaging commands. Report all four families separately. Distinguish static/local packaging checks from actual GitHub Actions build and downloaded-binary smoke tests; only claim CI delivery once those runs and artifacts have been checked.

## Metric Tool Version Audit

Run after every merge, including an already-up-to-date result, before final verification.

1. Read the release version from the exact `dev` commit being merged: `git show dev:packages/opencode/package.json`. Record that commit and version; also check the merged `packages/opencode/package.json` agrees.
2. Trace the actual generation payload through `SessionMetric.build()` in `packages/opencode/src/session/metric.ts` and `TempoMetric.sendGeneration()` in `packages/opencode/src/server/tempo-metric.ts`. The `toolVersion` sent to `/ai/data/api/record/saveGeneration` must equal the source release version.
3. If different, update the explicit `metricToolVersion` short-version constant to that version. Preserve the backend length limit and empty `ideVersion`; do not substitute a development/build suffix or `InstallationVersion`. If the source version exceeds the backend limit, report the incompatibility instead of silently truncating it.
4. Keep the payload regression assertion in `test/session/metric.test.ts` tied to the merged package version, so a future version bump fails when the constant is stale. Run it together with `test/server/tempo-metric.test.ts` from `packages/opencode`.
5. Replace stale fixed-version requirements in `travelsky/changes-baseline.md` and `travelsky/baseline-checklists/metric-reporting.md` with the source-version alignment rule. This exception only permits metric-version maintenance; preserve historical design records and all other invariants.

Complete only when the source version, merged package version, and actual payload `toolVersion` agree. Report the old and new values and test result; local tests do not establish that a deployed backend has received the new version.

## Verification

Run from package directories, never from repo root.

Always run:

```bash
cd packages/opencode && bun typecheck
```

Run focused Sapphire tests when present:

```bash
cd packages/opencode && bun test \
  test/cli/tui/thread.test.ts \
  test/cli/travelsky-auth-store.test.ts \
  test/cli/travelsky-login.test.ts \
  test/cli/travelsky-bootstrap.test.ts \
  test/server/tempo-metric.test.ts \
  test/session/metric.test.ts
```

If `packages/app`, `packages/desktop`, or `packages/desktop-electron` changed, inspect that package's `package.json` and run the nearest typecheck/test command.

If `packages/app/src/app.tsx`, `packages/app/src/context/global.tsx`, `packages/app/src/context/server-sdk.tsx`, or auth/provider shell code changed, also run:

```bash
cd packages/app && bun test src/app-provider-order.test.ts
```

## Final Response

Report:

- `dev` merged into `dev-sapphire`;
- conflicts resolved by area;
- how `bun.lock` was handled;
- baseline/checklist invariants preserved;
- CLI and desktop files touched;
- Bun version and packaging workflow audit results, with Windows Desktop, Windows CLI, Linux Desktop, and Linux CLI coverage reported separately;
- metric payload `toolVersion` compared with the merged dev version, any correction, and its regression result;
- verification commands and results;
- any unresolved risk or skipped verification.
