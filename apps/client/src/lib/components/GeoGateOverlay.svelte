<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let mode: 'checking' | 'blocked' | 'error' = 'blocked';
  export let title = '';
  export let message = '';
  export let details: { targetAddress?: string | null; distanceM?: number; rangeM?: number } = {};
  export let retryDisabled = false;
  export let retryCooldownS = 0;

  const dispatch = createEventDispatcher<{ retry: void }>();

  function handleRetry() {
    dispatch('retry');
  }
</script>

<div class="overlay" role="dialog" aria-modal="true" aria-label={title || 'Geo gate'}>
  <div class="panel">
    <h1 class="title">{title}</h1>
    <p class="message">{message}</p>

    {#if details?.targetAddress}
      <p class="detail"><span class="label">演出位置</span>{details.targetAddress}</p>
    {/if}
    {#if typeof details?.distanceM === 'number' && typeof details?.rangeM === 'number'}
      <p class="detail">
        <span class="label">距离</span>{Math.round(details.distanceM)} m（范围 {Math.round(details.rangeM)} m）
      </p>
    {/if}

    <button
      type="button"
      class="retry-btn"
      disabled={retryDisabled || mode === 'checking'}
      on:click={handleRetry}
    >
      {#if mode === 'checking'}
        正在检查位置…
      {:else if retryCooldownS > 0}
        重新检查（{retryCooldownS}s）
      {:else}
        重新检查位置
      {/if}
    </button>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 2000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: rgba(5, 4, 10, 0.92);
    backdrop-filter: blur(8px);
  }

  .panel {
    width: min(720px, 100%);
    border-radius: 16px;
    padding: 24px;
    border: 1px solid rgba(255, 228, 210, 0.18);
    background: rgba(16, 14, 24, 0.8);
    box-shadow: 0 18px 60px rgba(0, 0, 0, 0.55);
  }

  .title {
    margin: 0 0 12px;
    font-size: 26px;
    letter-spacing: 0.02em;
    color: rgba(255, 228, 210, 0.92);
  }

  .message {
    margin: 0 0 18px;
    font-size: 15px;
    line-height: 1.5;
    color: rgba(214, 201, 192, 0.85);
  }

  .detail {
    margin: 0 0 10px;
    font-size: 14px;
    color: rgba(214, 201, 192, 0.8);
    word-break: break-word;
  }

  .label {
    display: inline-block;
    width: 86px;
    color: rgba(214, 201, 192, 0.65);
  }

  .retry-btn {
    margin-top: 14px;
    width: 100%;
    padding: 14px 16px;
    border-radius: 12px;
    border: 1px solid rgba(255, 228, 210, 0.25);
    background: rgba(255, 228, 210, 0.12);
    color: rgba(255, 228, 210, 0.92);
    font-size: 16px;
    cursor: pointer;
  }

  .retry-btn:hover:not(:disabled) {
    background: rgba(255, 228, 210, 0.16);
    border-color: rgba(255, 228, 210, 0.4);
  }

  .retry-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
</style>

