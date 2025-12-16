<script lang="ts">
  import Ref from 'rete-svelte-plugin/svelte/Ref.svelte';
  import type { ClassicScheme, SvelteArea2D } from 'rete-svelte-plugin/svelte/presets/classic/types';

  type NodeExtraData = { width?: number; height?: number };

  function sortByIndex<K, I extends undefined | { index?: number }>(entries: [K, I][]) {
    entries.sort((a, b) => ((a[1] && a[1].index) || 0) - ((b[1] && b[1].index) || 0));
    return entries as [K, Exclude<I, undefined>][];
  }

  export let data: ClassicScheme['Node'] & NodeExtraData;
  export let emit: (props: SvelteArea2D<ClassicScheme>) => void;

  $: width = Number.isFinite(data.width) ? `${data.width}px` : '';
  $: height = Number.isFinite(data.height) ? `${data.height}px` : '';

  $: inputs = sortByIndex(Object.entries(data.inputs));
  $: controls = sortByIndex(Object.entries(data.controls));
  $: outputs = sortByIndex(Object.entries(data.outputs));
  function any<T>(arg: T): any {
    return arg;
  }
</script>

<div class="node {data.selected ? 'selected' : ''}" style:width style:height data-testid="node">
  <div class="title" data-testid="title">{data.label}</div>

  {#if controls.length}
    <div class="controls">
      {#each controls as [key, control]}
        <Ref
          class="control"
          data-testid={"control-" + key}
          init={(element) =>
            emit({
              type: 'render',
              data: {
                type: 'control',
                element,
                payload: control,
              },
            })}
          unmount={(ref) => emit({ type: 'unmount', data: { element: ref } })}
        />
      {/each}
    </div>
  {/if}

  <div class="ports">
    {#if inputs.length}
      <div class="inputs">
        {#each inputs as [key, input]}
          <div
            class="port-row input"
            data-testid={"input-" + key}
            data-rete-node-id={data.id}
            data-rete-port-side="input"
            data-rete-port-key={key}
          >
            <Ref
              class="input-socket"
              data-testid="input-socket"
              init={(element) =>
                emit({
                  type: 'render',
                  data: {
                    type: 'socket',
                    side: 'input',
                    key,
                    nodeId: data.id,
                    element,
                    payload: input.socket,
                  },
                })}
              unmount={(ref) => emit({ type: 'unmount', data: { element: ref } })}
            />
            <div class="port-body">
              <div class="port-label" data-testid="input-title">{input.label || ''}</div>
              {#if input.control}
                <Ref
                  class="port-control"
                  data-testid="input-control"
                  init={(element) =>
                    emit({
                      type: 'render',
                      data: {
                        type: 'control',
                        element,
                        payload: any(input).control,
                      },
                    })}
                  unmount={(ref) => emit({ type: 'unmount', data: { element: ref } })}
                />
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}

    {#if outputs.length}
      <div class="outputs">
        {#each outputs as [key, output]}
          <div
            class="port-row output"
            data-testid={"output-" + key}
            data-rete-node-id={data.id}
            data-rete-port-side="output"
            data-rete-port-key={key}
          >
            <div class="port-body">
              <div class="output-line">
                <div class="port-label" data-testid="output-title">{output.label || ''}</div>
                {#if any(output).control}
                  <Ref
                    class="port-control port-inline-value"
                    data-testid="output-control"
                    init={(element) =>
                      emit({
                        type: 'render',
                        data: {
                          type: 'control',
                          element,
                          payload: any(output).control,
                        },
                      })}
                    unmount={(ref) => emit({ type: 'unmount', data: { element: ref } })}
                  />
                {/if}
              </div>
            </div>
            <Ref
              class="output-socket"
              data-testid="output-socket"
              init={(element) =>
                emit({
                  type: 'render',
                  data: {
                    type: 'socket',
                    side: 'output',
                    key,
                    nodeId: data.id,
                    element,
                    payload: output.socket,
                  },
                })}
              unmount={(ref) => emit({ type: 'unmount', data: { element: ref } })}
            />
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .node {
    cursor: pointer;
    user-select: none;
    line-height: initial;
  }

  .title {
    padding: 10px 12px;
    font-weight: 700;
    letter-spacing: 0.2px;
    color: rgba(255, 255, 255, 0.92);
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .controls {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .ports {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 0 6px;
  }

  .inputs,
  .outputs {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .port-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 2px 10px;
  }

  .port-row.output {
    justify-content: flex-end;
  }

  :global(.input-socket) {
    margin-left: -10px;
    flex: 0 0 auto;
  }

  :global(.output-socket) {
    margin-right: -10px;
    flex: 0 0 auto;
  }

  .port-body {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
    min-width: 0;
  }

  .port-row.output .port-body {
    align-items: flex-end;
  }

  .output-line {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    width: 100%;
    min-width: 0;
  }

  .port-label {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.82);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  :global(.port-control) {
    width: 100%;
  }

  :global(.port-inline-value) {
    width: auto;
    flex: 0 0 auto;
  }
</style>
