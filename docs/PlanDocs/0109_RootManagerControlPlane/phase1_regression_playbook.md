<!--
Purpose: Phase 1 regression playbook (how to rerun the checklist fast + common pitfalls & fixes).
Owner: ShuGu / ControlPlane
Created: 2026-01-10
Status: Draft
-->

# Phase 1 Regression Playbook

This playbook is the “do it again quickly” guide for Phase 1 functional regression:

- Source checklist: `docs/PlanDocs/0109_RootManagerControlPlane/phase0_artifacts.md` (Regression Checklist v1)
- Logging format: `docs/PlanDocs/0109_RootManagerControlPlane/plan_progress.md`

## 0) Preflight (fast sanity)

Run these before any manual UI regression so failures are not “build broken” issues:

```bash
pnpm guard:deps
pnpm --filter @shugu/node-core run test
pnpm --filter @shugu/sdk-client run build
pnpm --filter @shugu/manager run build
pnpm --filter @shugu/client run build
```

If any step fails, stop and fix it first (Phase 1 is “功能回归”，not “边修边测 without build sanity”).

## 1) Dev stack (recommended ports)

We keep a dedicated port set to avoid “default port already in use” and cross-app confusion:

- Server: `https://localhost:3002`
- Manager: `https://127.0.0.1:5176/manager`
- Client: `https://127.0.0.1:5177/?server=https://localhost:3002&e2e=1`
- Display: `https://127.0.0.1:5175/display`

Start commands:

```bash
# Server (assets upload needs ASSET_WRITE_TOKEN)
PORT=3002 ASSET_WRITE_TOKEN=dev-write pnpm --filter @shugu/server run dev

# Manager / Client / Display (override default Vite ports when needed)
pnpm --filter @shugu/manager run dev -- --port 5176
pnpm --filter @shugu/client run dev -- --port 5177
pnpm --filter @shugu/display run dev
```

Notes:

- The dev servers are HTTPS (self-signed). Make sure you have accepted the cert in the browser for each origin you use.
- For local Display pairing (MessagePort), keep Manager + Display on the same hostname as much as possible (both `127.0.0.1` or both `localhost`).

## 2) Manual regression steps (match checklist categories)

### A) Control chain (Manager -> Server -> Client)

1. Open Manager, connect to Server, ensure at least one Client is connected and selected.
2. Use `ScreenColor`:
   - `Play Selected` should take effect.
   - `Stop Selected` should clear.
3. Use any other control (e.g. Flashlight, Synth) to ensure more than one action type works.

Recommended test mode:

- If doing deterministic regression, temporarily disable `⚡ Global Sync` (UI header toggle).

### B) Display local bridge (Manager -> Display MessagePort)

1. In Manager `🧰 Console`, open `🖥️ Display` panel.
2. Click `Open` (allow pop-up). In Display, make sure it initializes normally.
3. In Manager, click `Reconnect` if status is not stable. Expect:
   - `status=connected`
   - `ready=yes` (after multimedia manifest is ready)
4. Enable `Send To Display` and re-run a control like `screenColor` or `showImage` and observe Display mirrors it.

### C) Node graph & runtime

1. Go to `📊 Node Graph`.
2. Validate basic edit actions: add/remove nodes, connect/disconnect edges, deploy.
3. Validate loop edge case:
   - Build a loop between `client-object <-> proc-client-sensors`.
   - Ensure `localLoops=1` and loop export works (`exportGraphForLoop`).
4. Validate export/import roundtrip:
   - Export a patch from root nodes (e.g. `scene-out`).
   - Import back (loadGraph) and confirm behavior remains.

### D) Assets & media

1. Go to `🗂️ Assets Manager`, verify the upload token is set (must match server `ASSET_WRITE_TOKEN`).
2. Upload an image with a non-ASCII filename (e.g. `测试.png`) to catch header/URL edge cases.
3. Confirm:
   - Manifest updates and clients transition to “ready” (asset-ready).
   - `showImage`/`hideImage`, `visualSceneSwitch`, and `screenColor` behave correctly.

### E) Stability & high-frequency controls

1. During Start/Stop/Deploy/Scene switch loops, Manager should not crash and tab switching remains responsive.
2. Turn on `▶ Stream On` then:
   - Keep `Play Selected` active.
   - Drag a parameter (e.g. ScreenColor sliders) continuously.
   - Confirm multiple updates are being sent (throttled ~30ms).

## 3) Common pitfalls & quick fixes

### “Control executed but nothing happened”

- Check the selection: `selectedClientIds` must be non-empty for “Selected”.
- If `⚡ Global Sync` is enabled, ensure time sync is stable; otherwise disable it during regression to avoid “executeAt never reaches due to offset/time sync”.

### Display is connected but `ready=no` forever

- In local MessagePort mode, `ready` should be reported via the port after multimediaCore is ready.
- If Display fell back to Server transport (pair timeout), use `Reconnect` to late-pair back to local.

### Asset upload/scan works but preload fails (Client/Display stuck in loading)

- Re-check tokens:
  - Server has `ASSET_WRITE_TOKEN=...`
  - Manager upload token matches it
  - Display/Client has correct `assetReadToken` if your setup requires it
- Watch for `HEAD /api/assets/:id/content` errors in server logs (older builds could 500 on non-ASCII filenames).

### Server dev watch keeps failing on unlink / permission errors

- Symptom: watch rebuild fails repeatedly due to `dist-dev` permissions.
- Fix: use the dev tsconfig output directory `./dist-dev-local` (already configured in repo).

## 4) What to record in `plan_progress.md`

Copy template for a new regression run:

```md
### YYYY-MM-DD

- [x] Phase 1 preflight commands:
  - `pnpm guard:deps` ✅/❌
  - ...
- [x] Dev ports:
  - Server ...
- [x] Checklist v1:
  - [x] Control chain ...
  - [ ] ...
- [ ] Issues found:
  - Symptom -> root cause -> fix -> file path
```

