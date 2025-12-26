<!-- Purpose: Render a nested "group index" square (with children inside) for NodeCanvasToolbar. -->
<script lang="ts">
  type GroupIndexGroup = {
    id: string;
    parentId: string | null;
    name: string;
    disabled: boolean;
    runtimeActive?: boolean;
  };

  type GroupIndexNode = {
    group: GroupIndexGroup;
    children: GroupIndexNode[];
  };

  export let node: GroupIndexNode;
  export let depth = 0;
  export let onFocus: (groupId: string) => void = () => undefined;

  const sizeForDepth = (d: number) => {
    // Keep them "small squares" but ensure children are visibly nested inside parents.
    // (Previously child size matched the parent's inner box, making sub-groups look "missing".)
    if (d <= 0) return 40;
    if (d === 1) return 16;
    return 10;
  };

  $: size = sizeForDepth(depth);
  $: groupId = String(node?.group?.id ?? '');
  $: groupName = String(node?.group?.name ?? 'Group');
  $: isInactive = Boolean(node?.group?.disabled) || node?.group?.runtimeActive === false;

  const focusSelf = (event: MouseEvent) => {
    event.stopPropagation();
    if (!groupId) return;
    onFocus(groupId);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    if (!groupId) return;
    onFocus(groupId);
  };
</script>

<div
  class="group-index-item {isInactive ? 'inactive' : ''}"
  style={`--size: ${size}px;`}
  role="button"
  tabindex="0"
  title={groupName}
  aria-label={`Focus group ${groupName}`}
  on:click={focusSelf}
  on:keydown={onKeyDown}
>
  {#if (node?.children?.length ?? 0) > 0}
    <div class="group-index-children" aria-hidden="true">
      {#each node.children as child (child.group.id)}
        <svelte:self node={child} depth={depth + 1} {onFocus} />
      {/each}
    </div>
  {/if}
</div>

<style>
  .group-index-item {
    width: var(--size);
    height: var(--size);
    border-radius: 6px;
    border: 1px solid rgba(59, 130, 246, 0.52);
    background: rgba(59, 130, 246, 0.12);
    box-shadow: 0 8px 26px rgba(59, 130, 246, 0.12);
    position: relative;
    overflow: hidden;
    cursor: pointer;
    flex: 0 0 auto;
  }

  .group-index-item:hover {
    border-color: rgba(59, 130, 246, 0.72);
    background: rgba(59, 130, 246, 0.18);
  }

  .group-index-item:focus-visible {
    outline: 2px solid rgba(250, 204, 21, 0.7);
    outline-offset: 2px;
  }

  .group-index-item.inactive {
    border-color: rgba(148, 163, 184, 0.5);
    background: rgba(148, 163, 184, 0.14);
    box-shadow: 0 8px 26px rgba(148, 163, 184, 0.08);
  }

  .group-index-children {
    position: absolute;
    inset: 2px;
    display: flex;
    flex-wrap: wrap;
    align-content: flex-start;
    justify-content: flex-start;
    gap: 2px;
  }
</style>
