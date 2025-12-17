<script lang="ts">
  type Position = { x: number; y: number };

  // ConnectionWrapper spreads the connection payload into props.
  // Declare all common fields to avoid Svelte dev warnings about unknown props.
  // svelte-ignore unused-export-let
  export let id: string = '';
  // svelte-ignore unused-export-let
  export let source: string = '';
  // svelte-ignore unused-export-let
  export let target: string = '';
  // svelte-ignore unused-export-let
  export let sourceOutput: string = '';
  // svelte-ignore unused-export-let
  export let targetInput: string = '';
  // svelte-ignore unused-export-let
  export let isLoop: boolean | undefined = undefined;
  // svelte-ignore unused-export-let
  export let isPseudo: boolean | undefined = undefined;

  export let localLoop: boolean | undefined = undefined;
  export let deployedLoop: boolean | undefined = undefined;

  // svelte-ignore unused-export-let
  export let start: Position = { x: 0, y: 0 };
  // svelte-ignore unused-export-let
  export let end: Position = { x: 0, y: 0 };
  export let path: string = '';

  // Keep props "used" to avoid svelte-check warnings (the values are still useful for debugging).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let _debugProps: unknown;
  $: _debugProps = { source, target, sourceOutput, targetInput, isLoop, isPseudo, start, end };
</script>

<svg
  class="connection {localLoop ? 'local-loop' : ''} {deployedLoop ? 'deployed-loop' : ''}"
  data-connection-id={id}
  data-testid="connection"
>
  <path d={path} />
</svg>

<style>
  svg {
    overflow: visible !important;
    position: absolute;
    pointer-events: none;
    width: 9999px;
    height: 9999px;
  }

  svg path {
    fill: none;
    stroke-width: 5px;
    stroke: rgba(99, 102, 241, 0.6);
    pointer-events: auto;
    filter: drop-shadow(0 2px 12px rgba(0, 0, 0, 0.35));
    transition: stroke 120ms ease, stroke-width 120ms ease, opacity 120ms ease;
    opacity: 0.85;
  }

  svg.local-loop path {
    stroke: rgba(236, 72, 153, 0.9);
    stroke-width: 6px;
    opacity: 0.95;
  }

  svg.deployed-loop path {
    stroke: rgba(20, 184, 166, 0.95);
    stroke-width: 6px;
    opacity: 1;
  }
</style>
