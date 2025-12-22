<!--
  XYFlowEdge - Custom edge component for @xyflow/svelte.
  Matches styling of ReteConnection.svelte with no shadows by default.
-->
<script lang="ts">
  import { BaseEdge, getBezierPath } from '@xyflow/svelte';
  import type { EdgeProps } from '@xyflow/svelte';
  import { nodeGraphEdgeShadows } from '$lib/features/node-graph-flags';

  type $$Props = EdgeProps;

  export let id: string;
  export let sourceX: number;
  export let sourceY: number;
  export let targetX: number;
  export let targetY: number;
  export let sourcePosition: any;
  export let targetPosition: any;
  export let data: any = {};
  export let style: string = '';
  export let markerEnd: string = '';

  $: isActive = Boolean(data?.active);
  $: isLocalLoop = Boolean(data?.localLoop);
  $: isDeployedLoop = Boolean(data?.deployedLoop);

  $: [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  // Match ReteConnection.svelte highlight precedence: active > deployedLoop > localLoop > default.
  $: strokeColor = isActive
    ? 'rgba(250, 204, 21, 0.95)'
    : isDeployedLoop
      ? 'rgba(20, 184, 166, 0.95)'
      : isLocalLoop
        ? 'rgba(236, 72, 153, 0.9)'
        : 'rgba(99, 102, 241, 0.6)';

  $: strokeWidth = isActive ? 7 : isDeployedLoop || isLocalLoop ? 6 : 5;
  $: opacity = isActive ? 1 : isDeployedLoop ? 1 : isLocalLoop ? 0.95 : 0.85;

  // Shadows are optional (DEV toggle); default stays off for performance parity with Step 1.
  $: shadowsEnabled = $nodeGraphEdgeShadows;
  $: filterStyle = shadowsEnabled
    ? isActive
      ? 'drop-shadow(0 0 18px rgba(250, 204, 21, 0.35))'
      : 'drop-shadow(0 2px 12px rgba(0, 0, 0, 0.35))'
    : 'none';
</script>

<BaseEdge
  path={edgePath}
  {markerEnd}
  style="stroke: {strokeColor}; stroke-width: {strokeWidth}px; opacity: {opacity}; filter: {filterStyle}; {style}"
/>
