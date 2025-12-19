Purpose: Track step-by-step implementation progress for the Tone.js integration plan in docs/PlanDocs/1219_IntegrateToneJS/plan.md.

# Tone.js Integration Progress

- 2025-12-18: Step 0 — Reviewed plan and existing code (node-core definitions, NodeRuntime/NodeExecutor, client Start screen + permissions flow). Next: add tone-osc node definition in node-core.
- 2025-12-18: Step 1 — Added node-core definition for `tone-osc` (ports, config schema, lightweight process) and registered it in default node definitions. Next: implement sdk-client tone-adapter + registration.
- 2025-12-18: Step 2 — Added `packages/sdk-client/src/tone-adapter.ts` with dynamic Tone.js loading, per-node instances, master gain, and client-side overrides for `tone-osc`. Registered adapter in `NodeExecutor`, exported adapter API from sdk-client, and added Tone.js dependency. Ran `pnpm install --lockfile-only` to update lockfile.
- 2025-12-18: Step 3 — Implemented loop parsing + Tone.Transport scheduling with server-time alignment (via ClientSDK.scheduleAt). Loop updates reuse Tone.Part and update when pattern or defaults change.
- 2025-12-18: Step 4 — Added “启用音频” control to Start screen, wired enable flow to `enableToneAudio()` with persisted state, and gated `sound` capability via audio enablement in client store.
- 2025-12-18: Step 5 — Added Tone instance cleanup on deploy/remove/destroy (dispose osc/gain/loop, stop Transport when no loops) and centralized master gain usage to avoid per-node destinations.
- 2025-12-18: Fix — Added manager node spec for `tone-osc` (new JSON spec + runtime kind support) so it appears in Manager UI. Added `tone` dependency to `apps/client` to resolve Vite dynamic import from sdk-client dist. Updated lockfile.
- 2025-12-18: Fix — Installed workspace deps (tone), added Manager loop offload capability/whitelist for tone-osc to allow client execution.
- 2025-12-19: Added Tone.js effect/source nodes (delay, resonator, pitch, reverb, granular) to node-core + manager specs; extended client tone-adapter with bus-based effect chain and granular source; removed StartScreen audio button and auto-enable audio on start; created template graph in docs/PlanDocs/1219_IntegrateToneJS/templates/tone-audio-fx-template.json.
- 2025-12-19: Added Play Media + Load Media Sound nodes to node-core + manager specs; introduced file-picker config control in manager UI; whitelisted new nodes for client loop deployment; updated template to wire Load Media Sound -> Play Media -> Client.
- 2025-12-19: Added Tone Player source node for routing loaded audio through Tone FX on the client; added focused media template (tone-media-template.json) showing Load Media Sound → Tone Player → Tone FX (bus=media).
- 2025-12-19: Fixed Play Media to cache command objects and only emit on change/trigger to prevent manager freeze with large data URLs.
