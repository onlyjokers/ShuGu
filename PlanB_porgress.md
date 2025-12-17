# PlanB Progress

This file tracks implementation progress for `planB.md` (client-side execution for self-loops).

## Status

- [x] Task 1: Detect local client loops in Manager NodeEngine
- [x] Task 2: Highlight loops in Manager UI + Deploy controls
- [x] Task 3: Serialize / export loop subgraph for deployment
- [x] Task 4: Extend protocol + manager deploy messaging
- [x] Task 5: Implement client Node Runtime + node-executor plugin handler
- [x] Task 6: Capability checks + safety limits
- [x] Task 7: Docs / monitoring / rollback helpers

## Log

### 2025-12-17

- Initialized progress tracker.
- Task 1: Added `nodeEngine.localLoops` + SCC-based loop detection (includes sink edges), plus `markLoopDeployed()` and manager-side offload skipping in `tick()`: `apps/manager/src/lib/nodes/engine.ts`.
- Task 3: Added `exportGraphForLoop(loopId)` with a client-safe whitelist + `{graph, meta}` payload (includes `protocolVersion`, `executorVersion`, `tickIntervalMs`): `apps/manager/src/lib/nodes/engine.ts`.
- Task 2: Added local-loop detection UI in Node Graph (highlight nodes/edges + Deploy/Stop controls) and custom connection renderer for loop styling: `apps/manager/src/lib/components/nodes/NodeCanvas.svelte`, `apps/manager/src/lib/components/nodes/ReteNode.svelte`, `apps/manager/src/lib/components/nodes/ReteConnection.svelte`.
- Task 4: Extended protocol plugin commands to include `deploy/remove` and added `node-executor` as a named system plugin id; Manager Node Graph deploy now uses typed `sendPluginControl(..., 'node-executor','deploy', ...)`: `packages/protocol/src/types.ts`, `apps/manager/src/lib/components/nodes/NodeCanvas.svelte`.
- Task 5: Added client-side `NodeRuntime` + node definitions + `NodeExecutor` plugin handler, and wired it into the experience client to execute deployed loops locally: `packages/sdk-client/src/node-runtime.ts`, `packages/sdk-client/src/node-definitions.ts`, `packages/sdk-client/src/node-executor.ts`, `packages/sdk-client/src/client-sdk.ts`, `apps/client/src/lib/stores/client.ts`.
- Task 6: Added capability gating + resource limits (node count, tick interval, tick watchdog), plus manager-side deploy acknowledgement (wait for client status) to avoid false “deployed” states: `packages/sdk-client/src/node-executor.ts`, `packages/sdk-client/src/node-runtime.ts`, `packages/sdk-client/src/client-sdk.ts`, `apps/client/src/lib/stores/client.ts`, `apps/manager/src/lib/components/nodes/NodeCanvas.svelte`.
- Task 7: Added HTTPS key fallback for local server (`secrets/key.pem` or `secrets/privkey.pem`) so manager/client (https-only dev) can connect to server: `apps/server/src/main.ts`.
- Task 7: Added manager-side node-executor monitoring UI (exec running/stopped badge + logs panel) and rollback helper (Remove command): `apps/manager/src/lib/components/nodes/NodeCanvas.svelte`.
- Task 7: Added client watchdog reporting (`stopped` with `reason: watchdog`) so manager can surface runtime budget stops: `packages/sdk-client/src/node-executor.ts`.
- Task 7: Added E2E harness (Playwright) + dev hooks: manager exposes `window.__shuguNodeEngine` (DEV only), client supports `?e2e=1` auto-connect + synthetic sensors + command capture for assertions: `apps/manager/src/lib/components/nodes/NodeCanvas.svelte`, `apps/client/src/routes/+page.svelte`, `apps/client/src/lib/stores/client.ts`, `scripts/e2e/node-executor.mjs`, `package.json`.
- Task 7: Added docs for node-executor deployment/protocol/capabilities and updated README with a quick overview + e2e command: `docs/node-executor.md`, `README.md`.
