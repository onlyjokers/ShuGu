<!--
Purpose: Phase 2 “deletion list v2” (what to remove after Phase 1 baseline is proven).
Owner: ShuGu / System Architecture
Created: 2026-01-10
Status: Draft (actionable checklist)
-->

# Phase 2 Targets (Deletion List v2)

Phase 2 goal: **delete old / duplicate paths** so every capability has a single, obvious source of truth.

Guardrails:

- No new features; refactor-only.
- After each deletion batch, rerun Phase 1 regression (see `docs/PlanDocs/0109_RootManagerControlPlane/phase1_regression_playbook.md`).

---

## 0) Status of “Deletion List v1”

Phase 0’s original “giant file” targets are already split into smaller modules; most “v1 paths” are now thin facades:

- `apps/client/src/lib/stores/client.ts` (now a small facade over `apps/client/src/lib/stores/client/*`)
- `packages/sdk-client/src/tone-adapter.ts` (now a small facade over `packages/sdk-client/src/tone-adapter/*`)
- `packages/node-core/src/definitions.ts` (now a small facade over `packages/node-core/src/definitions/*`)

Phase 2 focus should therefore shift to **still-existing dual routes / duplicate implementations / transitional glue**.

---

## 1) Display: transport unification & delete bypasses

Single entry point (Manager → Display):

- Keep: `apps/manager/src/lib/display/display-transport.ts`
- Keep: `apps/manager/src/lib/display/display-bridge.ts` (local pairing implementation)
- Keep: `apps/display/src/lib/stores/display.ts` (Display-side transport + ready/reporting)

Phase 2 deletions / hardening:

- Delete/ban any direct Manager → Display sending outside `display-transport.ts`:
  - direct imports of `sendControl` / `sendPlugin` from `display-bridge.ts`
  - direct `sdk.sendControl(targetGroup('display'), ...)` usages
- Make `display-transport.ts` the only place that knows “local vs server fallback routing”.

Acceptance hook:

- `rg "sendLocalDisplay|targetGroup\\('display'\\)" apps/manager/src` should only hit `display-transport.ts` (and store wiring).

---

## 2) Media: duplicate VideoPlayer implementations

Today there are two app-local components:

- `apps/client/src/lib/components/VideoPlayer.svelte`
- `apps/display/src/lib/components/VideoPlayer.svelte`

Phase 2 target:

- Move shared player UI into a shared package module (decision required):
  - Option A: create a Svelte component inside `packages/ui-kit/` (adds Svelte build pipeline there)
  - Option B: keep UI in apps, but extract shared logic into `packages/multimedia-core/` (reduces duplication but does not fully delete)
- After shared module lands, delete one-off duplicated logic and make both apps import the shared implementation.

Acceptance hook:

- One shared implementation in `packages/*`; apps only contain thin wrappers (or none).

---

## 3) Audio execution: remove legacy players after Tone baseline

The client executor currently contains multiple generations of audio players in one file:

- `packages/sdk-client/src/action-executors.ts` (contains `SoundPlayer`, `ToneSoundPlayer`, `ModulatedSoundPlayer`, `ToneModulatedSoundPlayer`)

Phase 2 target:

- Delete deprecated / legacy paths once verified unnecessary:
  - `ModulatedSoundPlayer` (already marked deprecated)
  - `SoundPlayer` (legacy WebAudio/HTMLAudio hybrid), if Tone-backed player is stable for all required actions
- Optional cleanup: split audio executors into `packages/sdk-client/src/audio/*` to reduce “single file megastone”.

Acceptance hook:

- Phase 1 checklist still passes on iOS/Android constraints (user gesture, AudioContext policy).

---

## 4) Visual scenes: consolidate legacy single-scene vs multi-scene

There is still “legacy” single-scene behavior kept for compatibility:

- `apps/client/src/lib/components/VisualCanvas.svelte`
- `packages/visual-plugins/src/scene-manager.ts`
- `packages/sdk-manager/src/manager-sdk.ts` (legacy scene switch docs/behavior)

Phase 2 target:

- Decide the single supported semantics (single scene only vs multi scene) and delete the other branch.
- Prefer keeping the contract in `@shugu/protocol` clear: one action family, one meaning.

Acceptance hook:

- Scene switching flows in Phase 1 checklist remain intact; no “half enabled” states.

---

## 5) One-off migrations / transitional glue

These are useful during Phase 0/1, but should not live forever without an owner and sunset:

- `apps/manager/src/lib/assets/migrate-dataurls.ts` (legacy DataURL migration)
- MIDI legacy binding migrations in `apps/manager/src/lib/features/midi/*` (keep only if still needed)

Phase 2 target:

- Either (A) delete after confirming no longer needed, or (B) move behind an explicit “import older project” action.

---

## 6) Phase 2 execution order (recommended)

1. Display routing: delete bypasses, keep `display-transport` as single entry.
2. Audio legacy: remove deprecated players once Tone baseline holds.
3. Visual semantics: pick one behavior; delete the other.
4. Media duplication: migrate to shared module and delete duplicates.

At each step:

- `pnpm guard:deps`
- `pnpm lint` (0 errors)
- `pnpm build:all` (recommended)
- Phase 1 manual regression playbook

