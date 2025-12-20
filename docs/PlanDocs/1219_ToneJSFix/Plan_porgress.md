<!-- Purpose: Track implementation progress for docs/PlanDocs/1219_ToneJSFix/plan.md -->

# 1219_ToneJSFix Plan Progress

## Step 0 - Prep (branch + PR template) and log setup
- 2025-12-19: Attempted `git checkout -b feature/tone-audio-wiring-fix` but filesystem permissions prevent creating new refs under `.git/refs/heads` (Operation not permitted).
- 2025-12-19: Proceeding without new branch; will note this limitation in status updates.
- 2025-12-19: Plan progress log initialized.

- 2025-12-19: Added `.github/pull_request_template.md` with [tone-fix] title prefix guidance.

- 2025-12-19: Dev servers not started in this run (would block CLI session). Pending if you want me to run `pnpm dev:manager` / `pnpm dev:client`.

## Step 1 - Update node-core tone node ports to sink/any
- 2025-12-19: Updated tone node audio ports in `packages/node-core/src/definitions.ts` to `type: 'any'` + `kind: 'sink'` (osc out, delay/resonator/pitch/reverb in/out, granular/player outputs).
- 2025-12-19: Kept control ports as number; process functions remain lightweight (no Tone.js creation).
- 2025-12-19: Build/test not run yet (pending Step 6).

## Step 4 - Audio unlock flow
- 2025-12-19: Verified existing audio unlock flow: `apps/client/src/routes/+page.svelte` calls `enableAudio()` on Start; `apps/client/src/lib/stores/client.ts` uses `enableToneAudio()` to call `Tone.start()` + `ensureMasterGain()`.
- 2025-12-19: No code changes required for Step 4 at this time.

## Step 5 - Tone adapter cleanup + reduce heavy work in process
- 2025-12-19: Added audio graph wiring helpers and deferred wiring to a single rebuild (`applyGraphWiring`) instead of per-tick connections.
- 2025-12-19: Added explicit-bus separation: effects now track `wiredExternally` and bus chains skip explicitly wired effects.
- 2025-12-19: Strengthened cleanup in `disposeAll()` to dispose bus inputs and reset graph snapshot state.

## Step 2 - Graph-to-audio wiring
- 2025-12-19: `NodeExecutor` now passes `nodes` + `connections` into `toneAdapter.syncActiveNodes(...)`.
- 2025-12-19: `tone-adapter` now builds explicit audio connections from graph edges (source audio out -> effect in), connects terminal nodes to master, and falls back to bus chaining for non-explicit nodes.
- 2025-12-19: Client tone node port definitions updated to `type: 'any'` + `kind: 'sink'` to prevent audio edges from entering the compute DAG.

## Step 6 - Validation/testing
- 2025-12-19: Ran `pnpm -w lint` (repo-wide). Result: warnings only (existing warnings across packages + Tone adapter any-typed nodes). No errors.

- 2025-12-19: Verified `packages/node-core/src/definitions.ts` already had audio ports marked `any` + `sink` in HEAD (no git diff for Step 1).

## Fix - Deploy rejected when sound not enabled
- 2025-12-19: Loops were rejected when `sound` capability required but audio was not yet enabled on the client.
- 2025-12-19: Relaxed `canRunCapability('sound')` to allow deploy as long as an AudioContext exists (audio can be enabled later by user gesture).
- 2025-12-19: Change in `apps/client/src/lib/stores/client.ts`.

- 2025-12-19: Added explicit error string to node-executor rejection payload so Manager shows the missing capability instead of generic "rejected".

