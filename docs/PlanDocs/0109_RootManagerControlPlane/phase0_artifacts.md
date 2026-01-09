<!--
Purpose: Phase 0 artifacts for the Root/Manager ControlPlane plan (layer rules, deletion list v1, regression checklist v1).
Owner: ShuGu / System Architecture
Created: 2026-01-09
Status: Draft
-->

# Phase 0 Artifacts (v1)

> This file captures the Phase 0 outputs so the cleanup work is reviewable and testable.

---

## A. Layering & Dependency Rules (v0)

Current layering target (tighten over time):

```
apps/*
  -> packages/sdk-* | packages/ui-kit | packages/*-plugins | packages/multimedia-core
packages/sdk-*
  -> packages/node-core | packages/protocol | packages/multimedia-core
packages/node-core
  -> packages/protocol
packages/protocol
  -> (no @shugu deps)
```

Rules enforced today:

- Deep-imports are blocked unless explicitly exported by the package (by reading `package.json#exports`).
- `@shugu/protocol` must not import any other `@shugu/*` package.
- `@shugu/node-core` may only import `@shugu/protocol`.

Guard script:

- `scripts/guard-deps.mjs`
- Run: `pnpm guard:deps`

Notes:

- This is an intentionally minimal rule set to avoid blocking current functionality.
- We will tighten the layer map once the Phase 0 split is complete (e.g., add runtime/plugin layers).

---

## B. Deletion List v1 (Phase 2 target)

These entries are *candidates for removal* once the new modules land and Phase 1 regression passes. Do not delete yet.

- `apps/manager/src/lib/components/nodes/NodeCanvas.svelte`
  - Target: split into EditorView / RuntimeOrchestrator / Patch&Loop / Selection&UI.
- `packages/node-core/src/definitions.ts`
  - Target: split into domain node packs (math/logic/client/tone/media/visual/etc.).
- `packages/sdk-client/src/tone-adapter.ts`
  - Target: replace with AudioEngineHost + plugin-based tone nodes.
- `apps/client/src/lib/stores/client.ts`
  - Target: split into state, transport, executor, and media adapters.

Additional candidates (pending design freeze):

- Display dual-transport glue once unified transport abstraction ships.

---

## C. Regression Checklist v1 (must stay green)

Control chain:

- Manager -> Server -> Client control path still works.
- Manager -> Display local bridge still works (no forced server-only path).

Node graph & runtime:

- Node graph edit (add/remove/patch/loop/scene) works.
- Node deploy/export/import keeps current behavior.
- Existing node feature set remains intact (functional parity).

Assets & media:

- Asset manifest scan + distribution remains intact.
- Client multimedia layers (Visual/Audio/Effect) keep Activate/Deactivate semantics.
- Media actions: image upload, flash, mel-spectrum, screen color still function.

Stability:

- Manager does not crash on Start/Stop/Deploy/Scene switch.
- High-frequency controls remain responsive (30-60 fps UI).

---

## D. Next Phase 0 Outputs (planned)

- Add a stricter, explicit layer map once new runtime/plugin packages exist.
- Record a concrete “transport unification” deletion list when the Transport abstraction lands.
- Convert the checklist into runnable smoke tests where feasible.
