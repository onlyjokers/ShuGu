<script lang="ts">
  import {
    state,
    flashlight,
    vibrate,
    modulateSound,
    screenColor,
    playSound,
    switchScene,
    asciiMode,
    asciiResolution,
  } from '$lib/stores/manager';
  import { controlState, updateControlState } from '$lib/stores/controlState';
  import type { ScreenColorPayload } from '@shugu/protocol';
  import { onDestroy } from 'svelte';
  import {
    streamEnabled,
    sampleRateFps,
    setDraft,
    startStreamLoop,
    stopStreamLoop,
    clearDrafts,
    clearLastSent,
  } from '$lib/streaming/streaming';
  import { get } from 'svelte/store';

  let flashlightMode: 'off' | 'on' | 'blink' = 'off';
  let blinkFrequency = 2;
  let blinkDutyCycle = 0.5;

  let vibratePattern = '200,100,200';

  let modFrequency = 180;
  let modDuration = 200;
  let modVolume = 0.7;
  let modWaveform: 'sine' | 'square' | 'sawtooth' | 'triangle' = 'square';
  let modDepth = 0;
  let modLfo = 12;

  let selectedColor = '#6366f1';
  let colorOpacity = 1;
  let screenMode: 'solid' | 'blink' | 'pulse' | 'cycle' | 'modulate' = 'solid';
  let screenBlinkFrequency = 2;
  let screenPulseDuration = 1200;
  let screenPulseMin = 0.2;
  let screenCycleColors = '#6366f1,#22d3ee,#a855f7';
  let screenCycleDuration = 4000;
  let screenWaveform: 'sine' | 'square' | 'triangle' | 'sawtooth' = 'sine';
  let screenFrequency = 1.5;
  let screenMinOpacity = 0;
  let screenMaxOpacity = 1;
  let screenSecondaryColor = '#ffffff';

  let soundUrl = '';
  let soundUrl = '';
  let soundVolume = 1;
  let soundLoop = false;

  let selectedScene = 'box-scene';
  let asciiOn = true;
  let asciiRes = 11;
  let useSync = true; // Default to true for better experience
  let streamSampleRate = 30;

  $: synced = $controlState;
  $: asciiOn = synced.asciiOn;
  $: asciiRes = synced.asciiResolution;
  $: modFrequency = synced.modFrequency;
  $: modDuration = synced.modDuration;
  $: modVolume = synced.modVolume;
  $: modDepth = synced.modDepth;
  $: modLfo = synced.modLfo;
  $: modWaveform = synced.modWaveform;
  $: selectedScene = synced.selectedScene;
  $: soundVolume = synced.soundVolume;
  $: flashlightMode = synced.flashlightOn ? (flashlightMode === 'blink' ? 'blink' : 'on') : 'off';

  $: hasSelection = $state.selectedClientIds.length > 0;
  $: serverTime = Date.now() + $state.timeSync.offset;
  $: syncDelay = 500; // ms
  $: sampleRateFps.set(streamSampleRate);

  function getExecuteAt() {
    if (!useSync) return undefined;
    // Recalculate server time to be fresh
    const currentServerTime = Date.now() + $state.timeSync.offset;
    return currentServerTime + syncDelay;
  }

  function handleFlashlight(toAll = false) {
    const options =
      flashlightMode === 'blink'
        ? { frequency: blinkFrequency, dutyCycle: blinkDutyCycle }
        : undefined;
    flashlight(flashlightMode, options, toAll, getExecuteAt());
    updateControlState({ flashlightOn: flashlightMode !== 'off' });
  }

  function getFlashlightPayload() {
    const options =
      flashlightMode === 'blink'
        ? { frequency: blinkFrequency, dutyCycle: blinkDutyCycle }
        : undefined;
    return {
      mode: flashlightMode,
      frequency: options?.frequency,
      dutyCycle: options?.dutyCycle,
    };
  }

  function handleVibrate(toAll = false) {
    const pattern = vibratePattern
      .split(',')
      .map((s) => parseInt(s.trim()))
      .filter((n) => !isNaN(n));
    vibrate(pattern, undefined, toAll, getExecuteAt());
  }

  function handleModulateSound(toAll = false) {
    modulateSound(
      {
        frequency: Number(modFrequency) || 180,
        duration: Number(modDuration) || 200,
        volume: Math.max(0, Math.min(1, Number(modVolume) || 0.7)),
        waveform: modWaveform,
        modFrequency: modDepth > 0 ? Number(modLfo) || 12 : undefined,
        modDepth: modDepth > 0 ? Math.max(0, Math.min(1, modDepth)) : undefined,
      },
      toAll,
      getExecuteAt()
    );
    updateControlState({
      modFrequency: Number(modFrequency) || 180,
      modDuration: Number(modDuration) || 200,
      modVolume: Math.max(0, Math.min(1, Number(modVolume) || 0.7)),
      modDepth: Math.max(0, Math.min(1, modDepth)) || 0,
      modLfo: Number(modLfo) || 12,
      modWaveform,
    });
  }

  function handleScreenColor(toAll = false) {
    const payload: ScreenColorPayload = {
      mode: screenMode,
      color: selectedColor,
      opacity: colorOpacity,
    };

    if (screenMode === 'blink') {
      payload.blinkFrequency = screenBlinkFrequency;
    } else if (screenMode === 'pulse') {
      payload.pulseDuration = screenPulseDuration;
      payload.pulseMin = screenPulseMin;
      payload.waveform = screenWaveform;
    } else if (screenMode === 'cycle') {
      const colors = screenCycleColors
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      if (colors.length >= 2) {
        payload.cycleColors = colors;
      }
      payload.cycleDuration = screenCycleDuration;
    } else if (screenMode === 'modulate') {
      payload.waveform = screenWaveform;
      payload.frequencyHz = screenFrequency;
      payload.minOpacity = screenMinOpacity;
      payload.maxOpacity = screenMaxOpacity;
      if (screenSecondaryColor) {
        payload.secondaryColor = screenSecondaryColor;
      }
    }

    screenColor(payload, undefined, toAll, getExecuteAt());
  }

  function handlePlaySound(toAll = false) {
    if (!soundUrl) return;
    playSound(soundUrl, { volume: soundVolume, loop: soundLoop }, toAll, getExecuteAt());
  }

  function handleSwitchScene(toAll = false) {
    switchScene(selectedScene, toAll, getExecuteAt());
  }

  function handleAsciiToggle(toAll = false) {
    asciiMode(asciiOn, toAll, getExecuteAt());
    updateControlState({ asciiOn });
  }

  function handleAsciiResolution(toAll = false) {
    asciiResolution(Number(asciiRes), toAll, getExecuteAt());
    updateControlState({ asciiResolution: Number(asciiRes) });
  }

  // --- Streaming mode helpers ---
  function refreshStreamLoop() {
    // touch sampleRate to make Svelte track it as a dependency
    const _fps = streamSampleRate;
    void _fps;
    if ($streamEnabled) {
      startStreamLoop({
        senders: {
          screenColor: (payload, executeAt) => screenColor(payload, undefined, false, executeAt),
          asciiMode: (payload, executeAt) => asciiMode(payload.enabled, false, executeAt),
          asciiResolution: (payload, executeAt) =>
            asciiResolution(payload.cellSize, false, executeAt),
          visualSceneSwitch: (payload, executeAt) => switchScene(payload.sceneId, false, executeAt),
          flashlight: (payload, executeAt) =>
            flashlight(
              payload.mode,
              { frequency: payload.frequency, dutyCycle: payload.dutyCycle },
              false,
              executeAt
            ),
        },
        getExecuteAt,
        hasSelection: () => get(state).selectedClientIds.length > 0,
      });
    } else {
      stopStreamLoop();
      clearDrafts();
      clearLastSent();
    }
  }

  $: refreshStreamLoop();

  $: if ($streamEnabled) {
    setDraft(
      'screenColor',
      (() => {
        const payload: ScreenColorPayload = {
          mode: screenMode,
          color: selectedColor,
          opacity: colorOpacity,
        };

        if (screenMode === 'blink') {
          payload.blinkFrequency = screenBlinkFrequency;
        } else if (screenMode === 'pulse') {
          payload.pulseDuration = screenPulseDuration;
          payload.pulseMin = screenPulseMin;
          payload.waveform = screenWaveform;
        } else if (screenMode === 'cycle') {
          const colors = screenCycleColors
            .split(',')
            .map((c) => c.trim())
            .filter(Boolean);
          if (colors.length >= 2) {
            payload.cycleColors = colors;
          }
          payload.cycleDuration = screenCycleDuration;
        } else if (screenMode === 'modulate') {
          payload.waveform = screenWaveform;
          payload.frequencyHz = screenFrequency;
          payload.minOpacity = screenMinOpacity;
          payload.maxOpacity = screenMaxOpacity;
          if (screenSecondaryColor) {
            payload.secondaryColor = screenSecondaryColor;
          }
        }
        return payload;
      })()
    );

    setDraft('asciiMode', { enabled: asciiOn });
    setDraft('asciiResolution', { cellSize: Number(asciiRes) });
    setDraft('visualSceneSwitch', { sceneId: selectedScene });
    setDraft('flashlight', getFlashlightPayload());
  }

  onDestroy(() => {
    stopStreamLoop();
  });
</script>

<div class="card">
  <div class="card-header">
    <div class="header-row">
      <h3 class="card-title">Control Panel</h3>
      <label
        class="sync-toggle"
        title="Add 500ms delay to ensure all clients trigger simultaneously"
      >
        <input type="checkbox" bind:checked={useSync} />
        <span class="sync-label">⚡ Sync (500ms)</span>
      </label>
      <button
        class="btn btn-ghost stream-btn"
        on:click={() => streamEnabled.set(true)}
        disabled={$streamEnabled}
        title="Start Stream mode"
      >
        ▶ Stream
      </button>
      <label class="sync-toggle" title="Stream mode sends changes automatically at set FPS">
        <input type="checkbox" bind:checked={$streamEnabled} />
        <span class="sync-label">🌊 Stream</span>
      </label>
      {#if $streamEnabled}
        <div class="sample-rate">
          <input type="range" min="10" max="60" step="1" bind:value={streamSampleRate} />
          <span class="sync-label">{streamSampleRate} fps</span>
        </div>
      {/if}
    </div>
    {#if hasSelection}
      <span class="selection-count">{$state.selectedClientIds.length} selected</span>
    {/if}
  </div>

  <div class="control-sections">
    <!-- Flashlight -->
    <section class="control-section">
      <h4 class="section-title">💡 Flashlight</h4>
      <div class="control-group">
        <div class="control-row">
          <select class="select" bind:value={flashlightMode}>
            <option value="off">Off</option>
            <option value="on">On (Steady)</option>
            <option value="blink">Blink</option>
          </select>
        </div>

        {#if flashlightMode === 'blink'}
          <div class="control-row">
            <label class="control-label">Frequency</label>
            <input
              type="range"
              class="range-slider"
              bind:value={blinkFrequency}
              min="0.5"
              max="10"
              step="0.5"
            />
            <span class="value-display">{blinkFrequency} Hz</span>
          </div>
          <div class="control-row">
            <label class="control-label">Duty Cycle</label>
            <input
              type="range"
              class="range-slider"
              bind:value={blinkDutyCycle}
              min="0.1"
              max="0.9"
              step="0.1"
            />
            <span class="value-display">{Math.round(blinkDutyCycle * 100)}%</span>
          </div>
        {/if}

        <div class="button-group">
          <button
            class="btn btn-primary"
            on:click={() => handleFlashlight(false)}
            disabled={!hasSelection}
          >
            Apply to Selected
          </button>
          <button class="btn btn-secondary" on:click={() => handleFlashlight(true)}>
            Apply to All
          </button>
        </div>
      </div>
    </section>

    <!-- Vibration -->
    <section class="control-section">
      <h4 class="section-title">📳 Vibration</h4>
      <div class="control-group">
        <div class="control-row">
          <label class="control-label">Pattern</label>
          <input type="text" class="input" bind:value={vibratePattern} placeholder="200,100,200" />
        </div>
        <p class="hint">Comma-separated milliseconds: vibrate, pause, vibrate...</p>

        <div class="button-group">
          <button
            class="btn btn-primary"
            on:click={() => handleVibrate(false)}
            disabled={!hasSelection}
          >
            Vibrate Selected
          </button>
          <button class="btn btn-secondary" on:click={() => handleVibrate(true)}>
            Vibrate All
          </button>
        </div>
      </div>
    </section>

    <!-- Modulated Sound -->
    <section class="control-section">
      <h4 class="section-title">🎛️ Modulate Sound</h4>
      <div class="control-group">
        <div class="control-row">
          <label class="control-label">Frequency (Hz)</label>
          <input
            type="number"
            class="input input-small"
            bind:value={modFrequency}
            min="20"
            max="2000"
            step="10"
          />
        </div>
        <div class="control-row">
          <label class="control-label">Duration (ms)</label>
          <input
            type="number"
            class="input input-small"
            bind:value={modDuration}
            min="20"
            max="2000"
            step="10"
          />
        </div>
        <div class="control-row">
          <label class="control-label">Volume</label>
          <input
            type="range"
            class="range-slider"
            bind:value={modVolume}
            min="0"
            max="1"
            step="0.05"
          />
          <span class="value-display">{Math.round((Number(modVolume) || 0) * 100)}%</span>
        </div>
        <div class="control-row">
          <label class="control-label">Waveform</label>
          <select class="select" bind:value={modWaveform}>
            <option value="square">Square (buzzy)</option>
            <option value="sine">Sine</option>
            <option value="triangle">Triangle</option>
            <option value="sawtooth">Sawtooth</option>
          </select>
        </div>
        <div class="control-row">
          <label class="control-label">Wobble Depth</label>
          <input
            type="range"
            class="range-slider"
            bind:value={modDepth}
            min="0"
            max="1"
            step="0.05"
          />
          <span class="value-display">{Math.round((Number(modDepth) || 0) * 100)}%</span>
        </div>
        {#if modDepth > 0}
          <div class="control-row">
            <label class="control-label">Wobble Rate (Hz)</label>
            <input
              type="number"
              class="input input-small"
              bind:value={modLfo}
              min="1"
              max="40"
              step="1"
            />
          </div>
        {/if}

        <p class="hint">
          Sends a short synthesized tone (defaults to a buzz-like square wave) to clients;
          depth/rate adds a light wobble.
        </p>

        <div class="button-group">
          <button
            class="btn btn-primary"
            on:click={() => handleModulateSound(false)}
            disabled={!hasSelection}
          >
            Play on Selected
          </button>
          <button class="btn btn-secondary" on:click={() => handleModulateSound(true)}>
            Play on All
          </button>
        </div>
      </div>
    </section>

    <!-- Screen Color -->
    <section class="control-section">
      <h4 class="section-title">🎨 Screen Color</h4>
      <div class="control-group">
        <div class="control-row">
          <label class="control-label">Mode</label>
          <select class="select" bind:value={screenMode}>
            <option value="solid">Solid</option>
            <option value="blink">Blink</option>
            <option value="pulse">Pulse</option>
            <option value="cycle">Cycle</option>
            <option value="modulate">Modulate (Waveform)</option>
          </select>
        </div>
        <div class="control-row">
          <label class="control-label">Color</label>
          <input type="color" class="color-picker" bind:value={selectedColor} />
          <input type="text" class="input input-small" bind:value={selectedColor} />
        </div>
        <div class="control-row">
          <label class="control-label">Opacity</label>
          <input
            type="range"
            class="range-slider"
            bind:value={colorOpacity}
            min="0"
            max="1"
            step="0.05"
          />
          <span class="value-display">{Math.round(colorOpacity * 100)}%</span>
        </div>

        {#if screenMode === 'blink'}
          <div class="control-row">
            <label class="control-label">Blink Frequency</label>
            <input
              type="range"
              class="range-slider"
              bind:value={screenBlinkFrequency}
              min="0.5"
              max="10"
              step="0.5"
            />
            <span class="value-display">{screenBlinkFrequency} Hz</span>
          </div>
        {/if}

        {#if screenMode === 'pulse'}
          <div class="control-row">
            <label class="control-label">Pulse Duration</label>
            <input
              type="range"
              class="range-slider"
              bind:value={screenPulseDuration}
              min="300"
              max="4000"
              step="100"
            />
            <span class="value-display">{screenPulseDuration} ms</span>
          </div>
          <div class="control-row">
            <label class="control-label">Min Opacity</label>
            <input
              type="range"
              class="range-slider"
              bind:value={screenPulseMin}
              min="0"
              max="1"
              step="0.05"
            />
            <span class="value-display">{Math.round(screenPulseMin * 100)}%</span>
          </div>
          <div class="control-row">
            <label class="control-label">Waveform</label>
            <select class="select" bind:value={screenWaveform}>
              <option value="sine">Sine</option>
              <option value="square">Square</option>
              <option value="triangle">Triangle</option>
              <option value="sawtooth">Sawtooth</option>
            </select>
          </div>
        {/if}

        {#if screenMode === 'modulate'}
          <div class="control-row">
            <label class="control-label">Waveform</label>
            <select class="select" bind:value={screenWaveform}>
              <option value="sine">Sine</option>
              <option value="square">Square</option>
              <option value="triangle">Triangle</option>
              <option value="sawtooth">Sawtooth</option>
            </select>
          </div>
          <div class="control-row">
            <label class="control-label">Frequency</label>
            <input
              type="range"
              class="range-slider"
              bind:value={screenFrequency}
              min="0.2"
              max="20"
              step="0.2"
            />
            <span class="value-display">{screenFrequency.toFixed(1)} Hz</span>
          </div>
          <div class="control-row">
            <label class="control-label">Min Opacity</label>
            <input
              type="range"
              class="range-slider"
              bind:value={screenMinOpacity}
              min="0"
              max="1"
              step="0.05"
            />
            <span class="value-display">{Math.round(screenMinOpacity * 100)}%</span>
          </div>
          <div class="control-row">
            <label class="control-label">Max Opacity</label>
            <input
              type="range"
              class="range-slider"
              bind:value={screenMaxOpacity}
              min="0"
              max="1"
              step="0.05"
            />
            <span class="value-display">{Math.round(screenMaxOpacity * 100)}%</span>
          </div>
          <div class="control-row">
            <label class="control-label">Secondary Color</label>
            <input type="color" class="color-picker" bind:value={screenSecondaryColor} />
            <input type="text" class="input input-small" bind:value={screenSecondaryColor} />
            <p class="hint">
              Used when crossfading with waveform; set same as primary to only change brightness.
            </p>
          </div>
        {/if}

        {#if screenMode === 'cycle'}
          <div class="control-row">
            <label class="control-label">Colors (comma separated)</label>
            <input type="text" class="input" bind:value={screenCycleColors} />
          </div>
          <div class="control-row">
            <label class="control-label">Cycle Duration</label>
            <input
              type="range"
              class="range-slider"
              bind:value={screenCycleDuration}
              min="600"
              max="8000"
              step="200"
            />
            <span class="value-display">{screenCycleDuration} ms</span>
          </div>
        {/if}

        <div class="button-group">
          <button
            class="btn btn-primary"
            on:click={() => handleScreenColor(false)}
            disabled={!hasSelection}
          >
            Apply to Selected
          </button>
          <button class="btn btn-secondary" on:click={() => handleScreenColor(true)}>
            Apply to All
          </button>
          <button
            class="btn btn-secondary"
            on:click={() =>
              screenColor(
                { color: 'transparent', opacity: 0, mode: 'solid' },
                undefined,
                true,
                getExecuteAt()
              )}
          >
            Clear All
          </button>
        </div>
      </div>
    </section>

    <!-- Sound -->
    <section class="control-section">
      <h4 class="section-title">🔊 Sound</h4>
      <div class="control-group">
        <div class="control-row">
          <label class="control-label">URL</label>
          <input type="text" class="input" bind:value={soundUrl} placeholder="https://..." />
        </div>
        <div class="control-row">
          <label class="control-label">Volume</label>
          <input
            type="range"
            class="range-slider"
            bind:value={soundVolume}
            min="0"
            max="1"
            step="0.1"
            on:input={() => updateControlState({ soundVolume: Number(soundVolume) || 0 })}
          />
          <span class="value-display">{Math.round(soundVolume * 100)}%</span>
        </div>
        <div class="control-row">
          <label class="checkbox-label">
            <input type="checkbox" bind:checked={soundLoop} />
            Loop
          </label>
        </div>

        <div class="button-group">
          <button
            class="btn btn-primary"
            on:click={() => handlePlaySound(false)}
            disabled={!hasSelection || !soundUrl}
          >
            Play on Selected
          </button>
          <button
            class="btn btn-secondary"
            on:click={() => handlePlaySound(true)}
            disabled={!soundUrl}
          >
            Play on All
          </button>
        </div>
      </div>
    </section>

    <!-- Visual Scene -->
    <section class="control-section">
      <h4 class="section-title">🎬 Visual Scene</h4>
      <div class="control-group">
        <div class="control-row">
          <select
            class="select"
            bind:value={selectedScene}
            on:change={() => updateControlState({ selectedScene })}
          >
            <option value="box-scene">3D Box</option>
            <option value="mel-scene">Mel Spectrogram</option>
          </select>
        </div>

        <div class="button-group">
          <button
            class="btn btn-primary"
            on:click={() => handleSwitchScene(false)}
            disabled={!hasSelection}
          >
            Switch Selected
          </button>
          <button class="btn btn-secondary" on:click={() => handleSwitchScene(true)}>
            Switch All
          </button>
        </div>
      </div>
    </section>

    <!-- ASCII Post FX -->
    <section class="control-section">
      <h4 class="section-title">🅰️ ASCII Post FX</h4>
      <div class="control-group">
        <div class="control-row">
          <label class="checkbox-label">
            <input type="checkbox" bind:checked={asciiOn} />
            Enable ASCII overlay (default on)
          </label>
        </div>

        <div class="control-row">
          <label class="control-label">ASCII Resolution</label>
          <input
            type="range"
            class="range-slider"
            min="6"
            max="24"
            step="1"
            bind:value={asciiRes}
          />
          <span class="value-display">{Math.round(Number(asciiRes))} px</span>
        </div>

        <div class="button-group">
          <button
            class="btn btn-primary"
            on:click={() => handleAsciiToggle(false)}
            disabled={!hasSelection}
          >
            Apply to Selected
          </button>
          <button class="btn btn-secondary" on:click={() => handleAsciiToggle(true)}>
            Apply to All
          </button>
          <button
            class="btn btn-secondary"
            on:click={() => handleAsciiResolution(false)}
            disabled={!hasSelection}
          >
            Apply Resolution (Selected)
          </button>
          <button class="btn btn-secondary" on:click={() => handleAsciiResolution(true)}>
            Apply Resolution (All)
          </button>
        </div>
      </div>
    </section>
  </div>
</div>

<style>
  .header-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
  }

  .sync-toggle {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    cursor: pointer;
    background: rgba(255, 255, 255, 0.05);
    padding: 4px 8px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-color);
  }

  .sync-label {
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--color-warning);
  }

  .sample-rate {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    min-width: 120px;
  }

  .stream-btn {
    padding: 4px 10px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    background: var(--bg-tertiary);
  }

  .control-sections {
    display: flex;
    flex-direction: column;
    gap: var(--space-lg);
  }

  .control-section {
    padding-bottom: var(--space-lg);
    border-bottom: 1px solid var(--border-color);
  }

  .control-section:last-child {
    border-bottom: none;
    padding-bottom: 0;
  }

  .section-title {
    font-size: var(--text-base);
    font-weight: 600;
    margin-bottom: var(--space-md);
    color: var(--text-primary);
  }

  .selection-count {
    font-size: var(--text-sm);
    color: var(--color-primary);
    font-weight: 500;
  }

  .button-group {
    display: flex;
    gap: var(--space-sm);
    flex-wrap: wrap;
    margin-top: var(--space-md);
  }

  .value-display {
    min-width: 60px;
    text-align: right;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .color-picker {
    width: 40px;
    height: 40px;
    border: none;
    border-radius: var(--radius-md);
    cursor: pointer;
    padding: 0;
  }

  .input-small {
    width: 100px;
  }

  .hint {
    font-size: var(--text-xs);
    color: var(--text-muted);
    margin-top: var(--space-xs);
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    cursor: pointer;
    font-size: var(--text-sm);
  }

  .checkbox-label input {
    width: 16px;
    height: 16px;
  }
</style>
