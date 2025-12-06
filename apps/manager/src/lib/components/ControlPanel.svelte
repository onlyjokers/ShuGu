<script lang="ts">
  import {
    state,
    flashlight,
    vibrate,
    modulateSound,
    screenColor,
    playSound,
    switchScene,
  } from '$lib/stores/manager';

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

  let soundUrl = '';
  let soundVolume = 1;
  let soundLoop = false;

  let selectedScene = 'box-scene';

  $: hasSelection = $state.selectedClientIds.length > 0;

  function handleFlashlight(toAll = false) {
    const options =
      flashlightMode === 'blink'
        ? { frequency: blinkFrequency, dutyCycle: blinkDutyCycle }
        : undefined;
    flashlight(flashlightMode, options, toAll);
  }

  function handleVibrate(toAll = false) {
    const pattern = vibratePattern
      .split(',')
      .map((s) => parseInt(s.trim()))
      .filter((n) => !isNaN(n));
    vibrate(pattern, undefined, toAll);
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
      toAll
    );
  }

  function handleScreenColor(toAll = false) {
    screenColor(selectedColor, colorOpacity, toAll);
  }

  function handlePlaySound(toAll = false) {
    if (!soundUrl) return;
    playSound(soundUrl, { volume: soundVolume, loop: soundLoop }, toAll);
  }

  function handleSwitchScene(toAll = false) {
    switchScene(selectedScene, toAll);
  }
</script>

<div class="card">
  <div class="card-header">
    <h3 class="card-title">Control Panel</h3>
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
          <input type="number" class="input input-small" bind:value={modFrequency} min="20" max="2000" step="10" />
        </div>
        <div class="control-row">
          <label class="control-label">Duration (ms)</label>
          <input type="number" class="input input-small" bind:value={modDuration} min="20" max="2000" step="10" />
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
            <input type="number" class="input input-small" bind:value={modLfo} min="1" max="40" step="1" />
          </div>
        {/if}

        <p class="hint">
          Sends a short synthesized tone (defaults to a buzz-like square wave) to clients; depth/rate adds a light wobble.
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
            step="0.1"
          />
          <span class="value-display">{Math.round(colorOpacity * 100)}%</span>
        </div>

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
          <button class="btn btn-secondary" on:click={() => screenColor('transparent', 0, true)}>
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
          <select class="select" bind:value={selectedScene}>
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
  </div>
</div>

<style>
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
