<script lang="ts">
  import { fade } from 'svelte/transition';

  export let url: string;
  export let playing = true;
  export let muted = true;
  export let loop = false;
  export let volume = 1;
  export let startSec = 0;
  export let endSec = -1; // -1 means "to end"
  export let cursorSec = -1; // -1 means "unset"
  export let reverse = false;
  // Optional node graph source id (e.g. load-video-from-assets nodeId) for UI telemetry.
  export let sourceNodeId: string | null = null;
  export let onEnded: (() => void) | undefined = undefined;
  export let onStarted: ((nodeId: string) => void) | undefined = undefined;

  let videoElement: HTMLVideoElement;
  let visible = false;
  let loaded = false;
  let durationSec: number | null = null;

  let lastUrl = '';
  let lastCursorApplied: number | null = null;
  let rafId: number | null = null;
  let rafLastTs = 0;
  let startedReportKey = '';

  const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

  const getRange = () => {
    const start = Math.max(0, Number(startSec) || 0);
    const effectiveEnd =
      typeof endSec === 'number' && Number.isFinite(endSec) && endSec >= 0
        ? Math.max(start, endSec)
        : durationSec;
    return { start, end: effectiveEnd };
  };

  $: if (videoElement && loaded) {
    videoElement.volume = Math.max(0, Math.min(1, volume));
    videoElement.muted = muted;
  }

  function stopRaf() {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
    rafLastTs = 0;
  }

  function startRaf() {
    if (rafId !== null) return;
    const tick = (ts: number) => {
      if (!videoElement || !loaded || !playing || !url) {
        rafId = null;
        rafLastTs = 0;
        return;
      }

      const { start, end } = getRange();
      const hasEnd = typeof end === 'number' && Number.isFinite(end) && end > start;
      const endValue = hasEnd ? end! : null;
      const epsilon = 0.03;

      if (reverse) {
        // Manual reverse stepping: keep video paused and move `currentTime` backwards.
        try {
          if (!videoElement.paused) videoElement.pause();
        } catch {
          // ignore
        }

        const dt = rafLastTs > 0 ? Math.min(0.1, Math.max(0, (ts - rafLastTs) / 1000)) : 0;
        rafLastTs = ts;

        if (endValue !== null && videoElement.currentTime > endValue) {
          videoElement.currentTime = endValue;
        }

        const next = videoElement.currentTime - dt;
        if (next <= start + epsilon) {
          if (loop && endValue !== null) {
            videoElement.currentTime = endValue;
          } else {
            try {
              videoElement.pause();
            } catch {
              // ignore
            }
            visible = false;
            onEnded?.();
            stopRaf();
          }
        } else {
          videoElement.currentTime = next;
        }

        return;
      }

      // Forward playback: let the browser play, enforce clip range/loop.
      if (endValue !== null && videoElement.currentTime >= endValue - epsilon) {
        if (loop) {
          videoElement.currentTime = start;
        } else {
          try {
            videoElement.pause();
          } catch {
            // ignore
          }
          visible = false;
          onEnded?.();
          stopRaf();
        }
      } else if (videoElement.currentTime < start) {
        videoElement.currentTime = start;
      }

      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }

  function maybeReportStarted(): void {
    const nodeId = typeof sourceNodeId === 'string' ? sourceNodeId.trim() : '';
    if (!nodeId) return;
    if (!playing || !url) return;
    const key = `${nodeId}|${url}`;
    if (startedReportKey === key) return;
    startedReportKey = key;
    onStarted?.(nodeId);
  }

  function handlePlaying(): void {
    maybeReportStarted();
  }

  export function stop() {
    if (videoElement) {
      videoElement.pause();
      videoElement.currentTime = 0;
    }
    visible = false;
    stopRaf();
  }

  export function play() {
    visible = true;
    if (!reverse) videoElement?.play().catch(console.error);
  }

  function handleLoadedMetadata() {
    loaded = true;
    const dur = videoElement?.duration;
    durationSec = typeof dur === 'number' && Number.isFinite(dur) && dur > 0 ? dur : null;
  }

  $: if (url && url !== lastUrl) {
    lastUrl = url;
    loaded = false;
    durationSec = null;
    lastCursorApplied = null;
    startedReportKey = '';
    visible = Boolean(playing);
    stopRaf();
  }

  $: if (videoElement && loaded) {
    const { start, end } = getRange();
    const endValue = typeof end === 'number' && Number.isFinite(end) ? end : null;

    // Apply cursor seek (one-shot; won't re-seek unless cursor changes).
    const cursor = typeof cursorSec === 'number' && Number.isFinite(cursorSec) && cursorSec >= 0 ? cursorSec : null;
    if (cursor === null) {
      lastCursorApplied = null;
    } else {
      const clampedCursor =
        endValue !== null ? clamp(cursor, start, endValue) : Math.max(start, cursor);
      if (lastCursorApplied === null || Math.abs(clampedCursor - lastCursorApplied) > 0.01) {
        videoElement.currentTime = clampedCursor;
        lastCursorApplied = clampedCursor;
      }
    }

    // Keep currentTime inside the clip range when clip changes.
    if (reverse) {
      const desiredEnd = endValue ?? durationSec ?? start;
      if (endValue !== null && videoElement.currentTime > endValue) videoElement.currentTime = endValue;
      if (videoElement.currentTime < start) videoElement.currentTime = desiredEnd;
    } else {
      if (videoElement.currentTime < start) videoElement.currentTime = start;
      if (endValue !== null && videoElement.currentTime > endValue) videoElement.currentTime = start;
    }
  }

  $: if (videoElement && loaded) {
    if (playing && url) {
      visible = true;
      if (!reverse) {
        videoElement.play().catch(() => undefined);
      }
      startRaf();
      if (reverse) maybeReportStarted();
    } else {
      try {
        videoElement.pause();
      } catch {
        // ignore
      }
      visible = false;
      stopRaf();
      startedReportKey = '';
    }
  }
</script>

{#if url}
  <div class="video-overlay" class:visible transition:fade={{ duration: 500 }}>
    <video
      bind:this={videoElement}
      src={url}
      preload="auto"
      {loop}
      {muted}
      crossorigin="anonymous"
      playsinline
      on:playing={handlePlaying}
      on:loadedmetadata={handleLoadedMetadata}
    />
  </div>
{/if}

<style>
  .video-overlay {
    position: fixed;
    inset: 0;
    z-index: 0; /* Below ASCII overlay so ASCII can cover */
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    padding: 24px; /* Margin from screen edges */
    opacity: 0;
    pointer-events: none;
    transition: opacity 280ms ease;
  }

  .video-overlay.visible {
    opacity: 1;
    pointer-events: auto;
  }

  video {
    max-width: calc(100% - 48px);
    max-height: calc(100% - 48px);
    width: auto;
    height: auto;
    border-radius: 16px;
    box-shadow: 0 0 40px rgba(0, 0, 0, 0.8);
    object-fit: contain;
  }
</style>
