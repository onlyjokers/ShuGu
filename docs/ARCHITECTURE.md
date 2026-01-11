<!--
Purpose: Repository architecture map (apps/packages responsibilities, dependency rules, key data-flows, entry points, and known hotspots).
-->

# ShuGu Architecture Map

This document is a **high-signal index** for navigating the repo during refactors (Phase 1.5+), not a full spec.

## Repo Map (modules & responsibilities)

### Apps (`apps/*`)

- `apps/server/`: NestJS + Socket.io server (routing, client registry, time sync relay, assets API, local-media)
- `apps/manager/`: SvelteKit control UI (ControlPanel, NodeGraph editor, selection, scene switching)
- `apps/client/`: SvelteKit experience client (VisualCanvas, device sensors, audio capture/execution, visuals)
- `apps/display/`: SvelteKit display player (video/image playback), supports **local bridge** + **server fallback**

### Packages (`packages/*`)

- `packages/protocol/`: Shared message types + helpers (`@shugu/protocol`) — **lowest layer**
- `packages/node-core/`: NodeGraph runtime + node definitions (`@shugu/node-core`)
- `packages/sdk-manager/`: Manager Socket.io SDK (`@shugu/sdk-manager`)
- `packages/sdk-client/`: Client Socket.io SDK + executors (`@shugu/sdk-client`)
- `packages/multimedia-core/`: Shared audio/video helpers used by client/display (`@shugu/multimedia-core`)
- `packages/audio-plugins/`: Audio feature extraction / DSP helpers (`@shugu/audio-plugins`)
- `packages/visual-plugins/`: Three.js visuals (`@shugu/visual-plugins`)
- `packages/ui-kit/`: Shared UI components/styles (`@shugu/ui-kit`)

## Dependency rules (guardrails)

This repo uses `pnpm guard:deps` (see `scripts/guard-deps.mjs`) to prevent:

- **Deep imports** from `@shugu/*` packages (only `package.json#exports` subpaths are allowed)
- **Layer violations** (currently enforced):
  - `@shugu/protocol` must not depend on other `@shugu/*`
  - `@shugu/node-core` may depend on `@shugu/protocol` only

## Key data flows (what talks to what)

### 1) Control chain (Manager ⇄ Server ⇄ Clients)

- `apps/manager` uses `@shugu/sdk-manager` to connect to `apps/server` (Socket.io)
- `apps/client` uses `@shugu/sdk-client` to connect to `apps/server` (Socket.io)
- Manager sends `ControlMessage` / `PluginControlMessage` to Server; Server routes to target clients/groups
- Clients send `SensorDataMessage` / system events back; Manager observes client list + telemetry
- Time sync: Manager/Client SDKs periodically ping/pong and compute server time for scheduling

### 2) Assets (Manager → Server → Client/Display)

- Manager uploads/organizes assets; Server persists under `apps/server/data/assets/*`
- Client/Display fetch asset content via Server HTTP API
- Server should be robust to non-ASCII filenames in headers (see `apps/server/src/assets/assets.controller.ts`)

### 3) Display transport (local bridge + server fallback)

Two modes share the same UX goal: “Display reliably receives control/media updates”.

- **Local bridge (preferred on same machine)**:
  - Manager opens Display window with query params (pair token / server URL / asset read token)
  - Pairing via `window.postMessage` and transfers a dedicated `MessagePort`
  - Manager sends control/plugin/manifest via MessagePort
  - Display sends a one-shot `shugu:display:ready` back
  - Entry: `apps/manager/src/lib/display/display-bridge.ts`
- **Server fallback (for remote or when local bridge is unavailable)**:
  - Display connects to Server via `@shugu/sdk-client`
  - Receives control/plugin/media through the normal socket route
  - Entry: `apps/display/src/lib/stores/display.ts`

### 4) NodeGraph edit/deploy (Manager → Clients)

- NodeGraph is edited in Manager (Rete-based UI) and executed on Clients
- Core runtime/definitions live in `@shugu/node-core`
- Manager NodeGraph editor hotspot: `apps/manager/src/lib/components/nodes/NodeCanvas.svelte`
- Related docs: `docs/node-core.md`, `docs/node-executor.md`

## Entry index (quick navigation)

### `apps/server/`

- Entry: `apps/server/src/main.ts`
- Core routing: `apps/server/src/message-router/*`
- Assets API: `apps/server/src/assets/*`
- Client registry: `apps/server/src/client-registry/*`

### `apps/manager/`

- Routes entry: `apps/manager/src/routes/+page.svelte`
- Core store: `apps/manager/src/lib/stores/manager.ts`
- NodeGraph editor: `apps/manager/src/lib/components/nodes/NodeCanvas.svelte`
- Display bridge: `apps/manager/src/lib/display/display-bridge.ts`

### `apps/client/`

- Routes entry: `apps/client/src/routes/+page.svelte`
- Core store: `apps/client/src/lib/stores/client.ts`
- Main canvas: `apps/client/src/lib/components/VisualCanvas.svelte`
- Note: Camera display is still a DOM overlay managed by `VisualCanvas` (not a visual plugin yet).

### `apps/display/`

- Routes entry: `apps/display/src/routes/+page.svelte`
- Core store: `apps/display/src/lib/stores/display.ts`
- Player component: `apps/display/src/lib/components/VideoPlayer.svelte`
- Note: `screenColor` remains a control-action overlay (not part of Scene/Effect layers).

## Hotspots (known debt)

### >1000 LOC files (source only)

These are high-risk to touch and high ROI for Phase 2/3 cleanup:

- `apps/manager/src/lib/components/nodes/node-canvas/rete/ReteControl.svelte` (~2662)
- `apps/manager/src/lib/components/nodes/node-canvas/controllers/group-controller.ts` (~1667)
- `apps/manager/src/lib/nodes/specs/register.ts` (~1608)
- `apps/manager/src/lib/components/nodes/NodeCanvas.svelte` (~1573)
- `packages/sdk-client/src/action-executors.ts` (~1545)
- `packages/sdk-client/src/tone-adapter/register.ts` (~1461)
- `apps/manager/src/lib/components/nodes/node-canvas/runtime/patch-runtime.ts` (~1345)
- `apps/manager/src/lib/nodes/engine.ts` (~1241)
- `packages/sdk-client/src/tone-adapter/nodes.ts` (~1232)
- `apps/display/src/lib/stores/display.ts` (~1157)
- `apps/manager/src/lib/components/nodes/node-canvas/rete/ReteNode.svelte` (~1008)

### `@ts-nocheck` (must be tracked)

- `apps/manager/src/lib/components/nodes/NodeCanvas.svelte`
- `apps/manager/src/lib/components/nodes/node-canvas/ui/NodePickerOverlay.svelte`
- `apps/manager/src/lib/components/nodes/node-canvas/ui/NodeCanvasMinimap.svelte`
- `apps/manager/src/lib/components/nodes/node-canvas/ui/panels/ExecutorLogsPanel.svelte`
- `apps/manager/src/lib/components/nodes/node-canvas/ui/overlays/GroupFramesOverlay.svelte`
- `apps/manager/src/lib/components/nodes/node-canvas/ui/overlays/MarqueeOverlay.svelte`
- `apps/manager/src/lib/components/nodes/node-canvas/ui/overlays/LoopFramesOverlay.svelte`

### Split strategy (Phase 2/3 direction, not executed here)

- NodeGraph UI: keep “Rete adapter” isolated; move “runtime patch/app integration” behind a small facade.
- Display: extract `display-transport` module so “local MessagePort” and “server fallback” share one interface.
- SDK client audio: split Tone adapter into small feature modules (init, nodes registry, scheduling, teardown).

## Local build artifacts (what is safe to delete)

Generated locally (safe to remove, should not be committed):

- SvelteKit: `.svelte-kit*`, `build/`
- TypeScript/Nest: `dist*`, `dist-out/`, `dist-dev*`
- Tool caches: `.turbo/`, `coverage/`, `out/`

Recommended: use `pnpm clean:artifacts` (added in Phase 1.5.D) instead of manual deletion.

Note: if `pnpm clean:artifacts` reports `EACCES/EPERM`, some artifacts were created as `root` (e.g. running `pnpm` via `sudo`).
Fix once by changing ownership (e.g. `sudo chown -R $(whoami) <path>`) and avoid `sudo` for builds going forward.
