# Sapphire migration to OpenCode v2

## Baseline and scope

- Source: `dev` at `76ff9a6ab25fca4b8f0f5c43e4ef12bd0c10cc3e`, OpenCode 2.2.5.
- Previous Sapphire implementation: `3c9300847cb910b71eeeb349320b728e554992ae` (`dev-sapphire`).
- Migration branch: `sapphire-v2`, integrated into `dev-sapphire` after verification. The integration keeps the previous Sapphire history while adopting the v2 tree.
- The user's November 9 instruction supersedes the old merge protection checklist: use the new platform architecture and port the enterprise behavior into it.

## Required behavior

- Company login: SM2 password encryption, unchanged Tempo login request and model-list contract, production/development/custom host selection, token expiry, persistent token reuse, CLI startup login and Desktop login/remember-me.
- Desktop remembered passwords remain encrypted with Electron safeStorage. Failed recovery returns to login; concurrent recovery is shared. Preserve upstream local server authentication and connection recovery.
- TravelSky-only provider/model discovery, actual company model identifiers, per-model API URL/key/context/output limits, refreshed models usable for execution, and model-family prompts including dsv4 and Qwen aliases.
- Report each completed assistant response once to saveGeneration. Use final file changes (including non-git directories and tool metadata fallback), then addAdoption using the returned qaid. Preserve integer line counts, empty adoptedContent and ideVersion, same-origin cookie authentication, timeout/failure tolerance, and CLI/Desktop attribution. toolVersion must be the source release short version.
- Preserve diagnostic behavior and prompt/model selection fixes where still applicable to the new architecture.
- Windows Desktop x64/arm64 and standalone CLI archives; Linux Desktop x64/arm64 and standalone CLI archives, including supported baseline/musl targets. Use current upstream build/pack scripts, fork triggers, consistent version, no signing/publishing, fail on missing artifacts.

## Integration approach

- Put Tempo transport and credential/model state in Core; adapt into the native Provider plugin and Credential services.
- Expose enterprise login/status/logout through the current Protocol/Server experimental API and regenerate Client. Keep local server credentials independent of company credentials.
- Adapt App's current runtime and CLI startup to the new API. Use native Desktop IPC/storage for remembered credentials.
- Attach completion reporting to the current Session execution lifecycle; do not bring back the removed legacy runner.
- Rebuild fork workflows around `.github/workflows/release.yml`, `packages/cli/script/build.ts`, and current Desktop build/pack scripts.

## Progress

- [x] Updated local dev and created a clean migration branch; old Sapphire is preserved.
- [x] Inspected prior feature diff and new credential/provider/plugin architecture.
- [x] Tempo transport, credential persistence and expired-state handling.
- [x] Provider integration and enterprise model request authorization.
- [x] Protocol/Server endpoints and generated Client.
- [x] CLI login/model flow.
- [x] App/Desktop login, secure remember-me and recovery.
- [x] Completion metrics and file-change attribution.
- [x] Windows/Linux workflows adapted to current upstream build/pack scripts; YAML parsed successfully.
- [x] Focused tests, package type checks and local builds.

## Behavior on the new platform

- Server authentication remains OpenCode's local Basic/pairing authentication. Company login is a separate experimental API. Its credential uses integration ID `travelsky-login`; model provider `travelSky` uses the model-specific API keys from Tempo, never the login token.
- Core is environment-independent. The CLI host reads the Tempo environment settings and supplies them through Server options. Standalone Core embeddings leave enterprise mode disabled unless configured.
- The provider plugin replaces the exposed provider/model catalog with Tempo's authorized models. Credential/model events refresh the native client caches. Every model request checks current company access; refreshed URL/key values also apply to a previously resolved model route.
- The App gates the entire shell for the selected server: before company login, only the login form is rendered, without home/search/session tabs/new-session controls. Nested route providers reuse that gate. Status checks preserve the mounted session while pending. Local connection failures retry after reconnection; rejected passwords require an explicit retry.
- The upstream standalone server-connect screen now opens directly on address/password entry, without QR scanning, pairing links or camera probing. Native Desktop's automatic connection to its bundled service is unchanged; local server authentication remains separate from company authentication.
- Desktop remembered credentials use encrypted SQLite values through main-process RPC and Electron safeStorage. Linux `basic_text`, unavailable encryption and corrupt ciphertext fail closed. There is no plaintext password fallback. The web app does not offer password persistence.
- Family prompt supplements retain DeepSeek/dsv4, Qwen/QwQ/Tongyi, GLM and MiniMax behavior without replacing v2's native system/tool contracts. The legacy `providers.all().find(...)` fix no longer maps to the rewritten model selector. The old `ProtocolTraceStore` had no production callers; v2's native request tracing/diagnostics remain in place.
- Metrics run after a complete assistant answer, combine its text, use final filesystem differences, and report once per final assistant message ID. Non-Git directories use a scoped temporary repository, without creating a user `.git`. Desktop attribution is carried on the prompt. The actual payload `toolVersion` is `2.2.5`, matching source/root/CLI versions; `ideVersion` and `adoptedContent` remain empty.
- The login page explicitly stretches its two TextInput wrappers to the form width. The shared component's default 280px width is unchanged.

## Verification and limits

- Bun upgraded to the required 1.4.4. `bun.lock` retains the upstream dependency graph, adding only `sm-crypto` and its `jsbn` dependency.
- `bun run check`: repository lint plus all 34 package typechecks. Existing upstream lint warnings remain; no lint errors.
- Core: 303 tests across the six enterprise suites and three connected Session runner/request suites. Includes real SQLite, encrypted login request shape, expiry, provider restrictions, final non-Git diffs and duplicate reporting prevention.
- CLI: 3 admission tests. Server: 1 HTTP/generated-client integration test with native server authentication. App: 6 login lifecycle tests and 33 existing server-connect state tests.
- Desktop: 25 focused tests pass, with 4 Windows-only installer cases skipped on macOS. Credential coverage sends encoded renderer RPC messages through the real schema/handler and SQLite; only the Electron OS-keyring boundary is substituted in an isolated child process. The full Desktop test run was stopped while its upstream tests downloaded the missing Electron binary.
- Local macOS ARM64 CLI compilation, embedded Web production build, CLI startup/version smoke, Desktop renderer/main/preload builds and main/preload bundle syntax checks passed. These do not establish Windows/Linux installer acceptance.
- Browser smoke against an isolated compiled CLI and synthetic local Tempo service: native server password login, company login, new-session entry, TravelSky-only model selection, and token expiry returning to login were observed. The source App was also checked for a hidden shell before login, restored controls after login, and hidden controls again after logout. Input and submit widths were both measured at 384px. No real company credentials or model service were used.
- Workflows deliver four artifact families: Windows Desktop x64/arm64 installers; Windows CLI arm64/x64/baseline ZIPs; Linux Desktop x64/arm64 AppImage/deb/rpm; Linux CLI arm64/x64/baseline and musl tarballs. Both reuse upstream builders, one release version and fail-on-missing artifact checks. Windows uses the current two-stage app/NSIS packaging; Desktop waits for its matching compiled CLI.
- GitHub Actions, downloaded Windows/Linux binaries, native OS-keyring recovery and real Tempo/model/generation-backend acceptance still require those environments. No remote push or release publication is part of this local integration.
