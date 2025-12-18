# One Node System — Plan Progress

This file tracks the implementation progress for `docs/PlanDocs/1228_OneNodeSystem/plan.md`.

## Status

- [x] Step 1 — Create `@shugu/node-core` package (types/registry/runtime)
- [x] Step 2 — Move `NodeRuntime` into `node-core` + re-export from `sdk-client`
- [x] Step 3 — Make `NodeExecutor` use core runtime
- [x] Step 4 — Refactor Manager `NodeEngine` to wrap core runtime
- [x] Step 5 — Move shared node definitions into core (layering)
- [x] Step 6 — Tests + e2e verification
- [x] Step 7 — Cleanup duplicate code + docs

## Progress Log

### 2025-12-17

- Initialized progress tracking file.

### 2025-12-18

- Step 1: Created new workspace package `@shugu/node-core` with platform-agnostic:
  - `packages/node-core/src/types.ts`
  - `packages/node-core/src/registry.ts`
  - `packages/node-core/src/runtime.ts` (migrated from `@shugu/sdk-client` runtime implementation)
- Commands run:
  - `pnpm -w install --prefer-offline` (needed to restore/link node_modules for the new package)
  - `pnpm --filter @shugu/node-core run build`
- Step 2: Re-exported node-core runtime/types/registry from `@shugu/sdk-client` to keep the public API stable:
  - `packages/sdk-client/src/node-runtime.ts` now re-exports `NodeRuntime` from `@shugu/node-core`
  - `packages/sdk-client/src/node-registry.ts` and `packages/sdk-client/src/node-types.ts` now re-export from `@shugu/node-core` (avoids private-member type incompatibility)
  - `packages/sdk-client/package.json` now depends on `@shugu/node-core`
- Commands run:
  - `pnpm -w install --prefer-offline` (workspace relink)
  - `pnpm --filter @shugu/sdk-client exec tsc -p tsconfig.json --noEmit`
- Step 3: Updated `packages/sdk-client/src/node-executor.ts` to import `NodeRuntime`/`NodeRegistry` directly from `@shugu/node-core`.
- Commands run:
  - `pnpm --filter @shugu/sdk-client exec tsc -p tsconfig.json --noEmit`
- Step 4: Refactored Manager node system to use node-core:
  - `apps/manager/src/lib/nodes/types.ts` now re-exports types from `@shugu/node-core`
  - `apps/manager/src/lib/nodes/registry.ts` now uses `NodeRegistry` from `@shugu/node-core`
  - `apps/manager/src/lib/nodes/engine.ts` now wraps `NodeRuntime` from `@shugu/node-core` (stores + loop/offload remain manager-only)
  - `packages/node-core/src/runtime.ts` added `getNode()`, `compileNow()`, and `isNodeEnabled` gating to support Manager offload behavior
  - `packages/node-core/src/registry.ts` added `listByCategory()` for Manager UI
  - `apps/manager/package.json` now depends on `@shugu/node-core`
- Commands run:
  - `pnpm -w install --prefer-offline` (workspace relink)
  - `pnpm --filter @shugu/manager exec tsc -p tsconfig.json --noEmit`
- Step 5 (part 1): Moved client-side default node definitions into node-core and made `@shugu/sdk-client` re-export them:
  - Added `packages/node-core/src/definitions.ts` + exported it from `packages/node-core/src/index.ts`
  - `packages/sdk-client/src/node-definitions.ts` now re-exports definitions/types from `@shugu/node-core`
  - `packages/node-core/package.json` now depends on `@shugu/protocol`
- Commands run:
  - `pnpm --filter @shugu/node-core run build`
  - `pnpm --filter @shugu/sdk-client exec tsc -p tsconfig.json --noEmit`
- Step 5 (part 2): Made Manager JSON-spec runtimes reuse node-core implementations for shared kinds:
  - `packages/node-core/src/definitions.ts` expanded `ClientObjectDeps` with manager-friendly hooks:
    - `getSensorForClientId(clientId)`
    - `executeCommandForClientId(clientId, cmd)`
  - `apps/manager/src/lib/nodes/specs/register.ts` now sources runtime implementations for:
    - `client-object`, `proc-client-sensors`, `number`, `math`, `lfo`
    - (keeps JSON metadata/constraints while removing duplicated runtime code)
- Commands run:
  - `pnpm --filter @shugu/sdk-client exec tsc -p tsconfig.json --noEmit`
  - `pnpm --filter @shugu/manager exec tsc -p tsconfig.json --noEmit`
- Step 6 (part 1): Added node-core unit tests (Node built-in test runner) covering:
  - compile order + cycle detection (incl. sink-edge feedback)
  - input override TTL expiry
  - sink burst watchdog
  - oscillation watchdog
- Files added/updated:
  - `packages/node-core/test/runtime.test.mjs`
  - `packages/node-core/package.json` (`test` script)
- Commands run:
  - `pnpm --filter @shugu/node-core run test`
- Step 6 (part 2): Added an offline NodeExecutor verification script (no dev servers / no Playwright):
  - `packages/sdk-client/scripts/e2e/node-executor.offline.mjs`
  - root script: `pnpm e2e:node-executor:offline`
- Commands run:
  - `pnpm e2e:node-executor:offline`

- Step 6 (part 3): Attempted to run the full Playwright E2E, but the current sandbox environment blocks all
  localhost listens (`listen EPERM: operation not permitted`), so dev servers cannot bind ports.
  - Adjusted dev cache/output paths to avoid root-owned artifacts causing EACCES:
    - `apps/manager/vite.config.ts` / `apps/client/vite.config.ts` now use a per-user Vite `cacheDir`
    - `apps/server/tsconfig.dev.json` now uses `dist-dev-local` as `outDir`
  - Full E2E is ready to run on a normal machine:
    - `pnpm e2e:node-executor`
  - Offline verification still passes:
    - `pnpm e2e:node-executor:offline`

- Step 7: Cleaned up duplicated manager-side node runtime code and updated docs for the new architecture:
  - Removed unused legacy manager node definitions under `apps/manager/src/lib/nodes/nodes/` (replaced by JSON specs + node-core)
  - Updated docs:
    - `README.md` (node-core as single source of truth + offline E2E)
    - `docs/node-executor.md` (added node-core note + offline verification)
    - Added `docs/node-core.md` (architecture overview)
  - Commands run:
    - `pnpm lint`
    - `pnpm --filter @shugu/node-core run test`
    - `pnpm e2e:node-executor:offline`
