# Repository Guidelines

## Project Structure & Module Organization
- `apps/manager/` – SvelteKit control UI (ControlPanel, selection, scene switching).
- `apps/client/` – SvelteKit experience client (VisualCanvas, device sensors, audio capture).
- `packages/visual-plugins/` – Three.js visuals (box scene, mel spectrogram).
- `packages/audio-plugins/` – Audio feature extraction (mel spectrogram, split bands).
- `packages/sdk-client/`, `packages/sdk-manager/` – SDKs for control/data transport.
- `packages/protocol/` – Shared message/types; keep in sync when changing payloads.

## Build, Test, and Development Commands
- `pnpm dev:manager` / `pnpm dev:client` / `pnpm dev:server` – Run individual apps in dev mode.
- `pnpm dev:all` – Run all apps in parallel (fast feedback when changing protocol/SDK).
- `pnpm build:all` – Production builds for every workspace package.
- `pnpm lint` – Lints TS/Svelte across the monorepo.
- `pnpm format` – Runs Prettier on tracked sources.

## Coding Style & Naming Conventions
- TypeScript + Svelte; prefer explicit types on public APIs and payloads.
- Indentation: 2 spaces; keep lines < 120 chars when practical.
- Components: `PascalCase.svelte`; utilities/helpers: `camelCase.ts`.
- Favor small, pure functions inside `packages/*`; avoid side-effects in module scope.
- Run `pnpm format` before pushing; Prettier config is repo-wide.
- Remember to comment when adding new features.
- When creating a new file, write the purpose/role of the file at the top
- When making drastic changes to a feature, file, some obsolete features, file comments you need to rewrite

## Testing Guidelines
- Add focused unit tests alongside code (e.g., `*.spec.ts`) when introducing protocol or DSP changes.
- At minimum, run `pnpm lint`; add regression tests for sensor mapping, audio feature math, and protocol serialization when modified.
- Keep test data small and deterministic; mock browser APIs for motion/audio when needed.

## Commit & Pull Request Guidelines
- Commits: concise, imperative mood (e.g., "Add mel spectrogram canvas fallback"). Group related changes; avoid noise.
- PRs: include summary, key verification steps (commands run), affected areas (manager/client/sdk), and screenshots/GIFs for UI changes.
- Link issues/task IDs when available; call out breaking changes in protocol or SDK contracts explicitly.

## Security & Configuration Tips
- Do not commit secrets; keep credentials in `secrets/` or local env files outside VCS.
- When touching networking or permissions, verify both HTTPS and localhost flows (`serverUrl` handling in client startup).
- Mind user-gesture requirements on mobile (audio/vibration); initialize such features inside click/tap handlers.
