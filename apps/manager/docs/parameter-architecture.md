# Manager Parameter Architecture (Phase 1–2)

Goal: make Manager data-driven and decoupled so UI / MIDI / nodes all read+write the same parameter objects.

## Key pieces
- `Parameter` — holds base value, modulation offsets, metadata, listeners; prevents noisy emits.
- `ParameterRegistry` — singleton map of `path -> Parameter`; paths are slash-based (`controls/synth/volume`).
- `parameterWritable` / `parameterReadable` — Svelte stores that mirror a `Parameter` (two-way safe).
- `ModulationMatrix` / `ModulationLink` — light polling scheduler to feed modulation offsets (e.g., MIDI CC) into parameters.
- Auto-UI — `ParameterControl` renders the right widget based on parameter type/metadata; `ParameterPanel` renders a prefix group.

## Quick start: register parameters
```ts
import { parameterRegistry } from '$lib/parameters';

parameterRegistry.register<number>({
  path: 'controls/synth/volume',
  type: 'number',
  defaultValue: 0.7,
  min: 0,
  max: 1,
  metadata: { label: 'Volume', widget: 'slider', step: 0.05 },
});
```

## Bind to Svelte
```svelte
<script lang="ts">
  import { parameterWritable } from '$lib/parameters';
  import { ParameterControl } from '$lib/components/parameters';
  const volume = parameterWritable(parameterRegistry.get('controls/synth/volume')!);
</script>

<ParameterControl path="controls/synth/volume" />
<!-- Or manual binding -->
<Slider bind:value={$volume} min={0} max={1} step={0.05} />
```

Signals are loop-safe: internal `setValue` only emits when the effective value actually changes.

## Modulation matrix (MIDI / nodes)
```ts
import { ModulationMatrix } from '$lib/parameters';
import { readMidiCc } from './midi'; // implement elsewhere

const matrix = new ModulationMatrix();
matrix.addLink({
  id: 'cc1->volume',
  targetPath: 'controls/synth/volume',
  source: () => readMidiCc(1), // returns 0..1
  amount: 1,
});
matrix.start(30); // poll every 30ms
```

`setModulation` keeps base UI value intact; effective value = base + sum(offsets).

## Auto-UI factory
- `ParameterControl`: give it a path, it renders Slider / Toggle / Select / Input / Button, with two-way binding.
- `ParameterPanel`: render all params under a prefix.

## Current migration status
- Synth panel now uses the registry and auto-UI; control-state coupling removed.
- Registry presets seeded in `registerDefaultControlParameters()` for synth controls.

## Next steps (Phase 3–4 hooks)
- Wire MIDI CC readers into `ModulationMatrix` (see `parameters/modulation.ts`).
- For node graphs (e.g., ryvencore), read/write via `parameterRegistry.get(path)?.setValue(...)` and listen with `addListener`.
- Gradually port other feature panels by registering their params and swapping to `ParameterControl`.
