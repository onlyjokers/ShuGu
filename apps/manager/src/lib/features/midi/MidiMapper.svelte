<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import {
    asciiMode,
    asciiResolution,
    clients,
    flashlight,
    modulateSound,
    screenColor,
    selectClients,
    stopMedia,
    switchScene,
    vibrate,
  } from '$lib/stores/manager';
  import { updateControlState } from '$lib/stores/controlState';
  import Button from '$lib/components/ui/Button.svelte';
  import { formatClientId } from '@shugu/ui-kit';

  type Scope = 'selected' | 'all';
  type SlotKind = 'boolean' | 'fuzzy';
  type MidiMessageType = 'cc' | 'note' | 'pitchbend';

  type MidiBinding = {
    messageType: MidiMessageType;
    channel: number;
    number?: number;
  };

  type ControlSlot = {
    id: string;
    label: string;
    kind: SlotKind;
    binding?: MidiBinding;
    lastRaw?: number;
    lastNormalized?: number;
    targetId?: string;
    scope?: Scope;
    lastApplied?: string;
    lastUpdated?: number;
  };

  type ParsedMessage = {
    binding: MidiBinding;
    raw: number;
    normalized: number;
    isPress: boolean;
    nature: 'button' | 'continuous';
  };

  type ContinuousTarget = {
    id: string;
    label: string;
    compute: (
      normalized: number
    ) => { value: unknown; display: string } | null;
    apply: (value: unknown, scope: Scope) => void;
  };

  type ButtonTarget = {
    id: string;
    label: string;
    onPress: (scope: Scope) => string | void;
  };

  const continuousTargets: ContinuousTarget[] = [
    {
      id: 'client-selector',
      label: 'Clients (0-1 → select client)',
      compute: (normalized) => {
        if ($clients.length === 0) return { value: null, display: 'No clients' };
    const idx = Math.min(
      $clients.length - 1,
      Math.max(0, Math.floor(normalized * $clients.length))
    );
    const client = $clients[idx];
        return {
          value: client.clientId,
          display: `${formatClientId(client.clientId)} (#${idx + 1})`,
        };
      },
      apply: (value) => {
        if (typeof value === 'string') {
          selectClients([value]);
          updateControlState({});
        }
      },
    },
    {
      id: 'freq-hz',
      label: 'Synth Frequency (Hz)',
      compute: (normalized) => {
        const freq = mapRange(normalized, 50, 1200);
        return { value: freq, display: `${Math.round(freq)} Hz` };
      },
      apply: (value, scope) => {
        if (typeof value !== 'number') return;
        modulateSound(
          {
            frequency: value,
            duration: 160,
            volume: 0.65,
            waveform: 'sine',
          },
          scope === 'all'
        );
        updateControlState({ modFrequency: value });
      },
    },
    {
      id: 'screen-opacity',
      label: 'Screen Opacity',
      compute: (normalized) => {
        const opacity = clamp01(normalized);
        return { value: opacity, display: `${Math.round(opacity * 100)}%` };
      },
      apply: (value, scope) => {
        if (typeof value !== 'number') return;
        screenColor({ color: '#ffffff', opacity: value, mode: 'solid' }, undefined, scope === 'all');
        updateControlState({ screenOpacity: value });
      },
    },
    {
      id: 'ascii-resolution',
      label: 'ASCII Resolution (6–24px)',
      compute: (normalized) => {
        const res = Math.round(mapRange(normalized, 6, 24));
        return { value: res, display: `${res} px` };
      },
      apply: (value, scope) => {
        if (typeof value !== 'number') return;
        asciiResolution(value, scope === 'all');
        updateControlState({ asciiResolution: value });
      },
    },
  ];

  const buttonTargets: ButtonTarget[] = [
    {
      id: 'flashlight-toggle',
      label: 'Toggle Flashlight (on/off)',
      onPress: (scope) => {
        flashlightState = !flashlightState;
        flashlight(flashlightState ? 'on' : 'off', undefined, scope === 'all');
        updateControlState({ flashlightOn: flashlightState });
        return flashlightState ? 'Flashlight ON' : 'Flashlight OFF';
      },
    },
    {
      id: 'flashlight-blink',
      label: 'Flashlight Blink (2Hz)',
      onPress: (scope) => {
        flashlight('blink', { frequency: 2, dutyCycle: 0.5 }, scope === 'all');
        updateControlState({ flashlightOn: true });
        return 'Blink 2 Hz';
      },
    },
    {
      id: 'ascii-toggle',
      label: 'Toggle ASCII overlay',
      onPress: (scope) => {
        asciiState = !asciiState;
        asciiMode(asciiState, scope === 'all');
        updateControlState({ asciiOn: asciiState });
        return asciiState ? 'ASCII ON' : 'ASCII OFF';
      },
    },
    {
      id: 'vibe-pulse',
      label: 'Vibration pulse (200,100,200)',
      onPress: (scope) => {
        vibrate([200, 100, 200], undefined, scope === 'all');
        return 'Vibe pulse';
      },
    },
    {
      id: 'scene-toggle',
      label: 'Toggle Scene (Box/Mel)',
      onPress: (scope) => {
        sceneIsMel = !sceneIsMel;
        switchScene(sceneIsMel ? 'mel-scene' : 'box-scene', scope === 'all');
        updateControlState({ selectedScene: sceneIsMel ? 'mel-scene' : 'box-scene' });
        return sceneIsMel ? 'Scene: Mel Spectrogram' : 'Scene: 3D Box';
      },
    },
    {
      id: 'stop-media',
      label: 'Stop all media',
      onPress: (scope) => {
        stopMedia(scope === 'all');
        return 'Stop media';
      },
    },
  ];

  let slots: ControlSlot[] = [];
  let slotCounter = 1;

  let midiAccess: WebMidi.MIDIAccess | null = null;
  let midiInputs: WebMidi.MIDIInput[] = [];
  let selectedInputId = '';
  let listeningSlotId: string | null = null;
  let errorMessage = '';
  let infoMessage = '';
  let lastMessageBrief = '';
  let lastParsed: ParsedMessage | null = null;

  let flashlightState = false;
  let asciiState = false;
  let sceneIsMel = false;

  const STORAGE_KEY = 'midi-mapper-slots-v1';
  const INPUT_KEY = 'midi-mapper-input';

  onMount(() => {
    hydrateFromStorage();

    if (typeof navigator === 'undefined' || !navigator.requestMIDIAccess) {
      errorMessage = 'This browser does not support Web MIDI API (try Chrome).';
      return;
    }

    navigator
      .requestMIDIAccess()
      .then((access) => {
        midiAccess = access;
        refreshInputs();
        access.onstatechange = () => refreshInputs();
      })
      .catch(() => {
        errorMessage = 'Failed to get MIDI permission. Please allow MIDI access.';
      });
  });

  onDestroy(() => {
    detachListeners();
  });

  function refreshInputs() {
    if (!midiAccess) return;
    midiInputs = Array.from(midiAccess.inputs.values());
    const existing = midiInputs.find((input) => input.id === selectedInputId);
    const preferred = midiInputs.find((input) =>
      input.name?.toLowerCase().includes('smc') || input.name?.toLowerCase().includes('mvave')
    );

    if (!existing && (preferred || midiInputs[0])) {
      selectInput(preferred?.id ?? midiInputs[0].id);
    } else if (existing) {
      selectInput(existing.id);
    }
  }

  function detachListeners() {
    if (!midiAccess) return;
    midiAccess.inputs.forEach((input) => {
      input.onmidimessage = null;
    });
  }

  function selectInput(id: string) {
    detachListeners();
    selectedInputId = id;
    const input = midiInputs.find((m) => m.id === id);
    if (input) {
      input.onmidimessage = handleMidi;
      infoMessage = `Listening to ${input.name ?? 'MIDI device'}`;
    }
    persistSlots();
  }

  function bindingMatches(binding: MidiBinding, parsed: ParsedMessage) {
    if (binding.messageType !== parsed.binding.messageType) return false;
    if (binding.channel !== parsed.binding.channel) return false;
    if (binding.messageType !== 'pitchbend') {
      return binding.number === parsed.binding.number;
    }
    return true;
  }

  function parseMessage(event: WebMidi.MIDIMessageEvent): ParsedMessage | null {
    const [status, data1 = 0, data2 = 0] = event.data;
    const command = status & 0xf0;
    const channel = status & 0x0f;

    if (command === 0x90 || command === 0x80) {
      // Note on/off -> button
      const velocity = command === 0x80 ? 0 : data2;
      const normalized = velocity / 127;
      return {
        binding: { messageType: 'note', channel, number: data1 },
        raw: velocity,
        normalized,
        isPress: normalized > 0,
        nature: 'button',
      };
    }

    if (command === 0xb0) {
      // Control Change
      const value = data2;
      const normalized = value / 127;
      const nature: 'button' | 'continuous' = value === 0 || value === 127 ? 'button' : 'continuous';
      return {
        binding: { messageType: 'cc', channel, number: data1 },
        raw: value,
        normalized,
        isPress: value > 0,
        nature,
      };
    }

    if (command === 0xe0) {
      // Pitch Bend (14-bit) -> treat as fader
      const value14 = data1 + (data2 << 7);
      const normalized = value14 / 16383;
      return {
        binding: { messageType: 'pitchbend', channel },
        raw: value14,
        normalized,
        isPress: true,
        nature: 'continuous',
      };
    }

    return null;
  }

  function handleMidi(event: WebMidi.MIDIMessageEvent) {
    const parsed = parseMessage(event);
    if (!parsed) return;

    const description = describeParsed(parsed);
    lastMessageBrief = description;
    lastParsed = parsed;

    if (listeningSlotId) {
      const slot = slots.find((s) => s.id === listeningSlotId);
      if (slot) {
        if (!isNatureCompatible(slot.kind, parsed.nature)) {
          infoMessage = 'Signal type does not match this control (button vs. fader).';
        } else {
          assignBinding(slot.id, parsed.binding);
          infoMessage = `Bound ${slot.label} to ${description}`;
        }
      }
      listeningSlotId = null;
      persistSlots();
      return;
    }

    const slot = slots.find((s) => s.binding && bindingMatches(s.binding, parsed));
    if (!slot) return;

    updateSlot(slot.id, (current) => ({
      ...current,
      lastRaw: parsed.raw,
      lastNormalized: parsed.normalized,
      lastUpdated: Date.now(),
    }));

    if (slot.targetId) {
      applyMapping(slot.id, parsed);
    }
  }

  function isNatureCompatible(kind: SlotKind, nature: ParsedMessage['nature']) {
    if (kind === 'boolean') return nature === 'button';
    return nature === 'continuous';
  }

  function addSlot(kind: SlotKind) {
    if (!lastParsed) {
      infoMessage = '先触发一次 MIDI 控件，再点加号。';
      return;
    }
    if (!isNatureCompatible(kind, lastParsed.nature)) {
      infoMessage = kind === 'boolean' ? '需要按钮类 MIDI 信号' : '需要推杆/旋钮类连续信号';
      return;
    }
    const id = `${kind}-${slotCounter++}`;
    const label = kind === 'boolean' ? `Bool Map ${slotCounter - 1}` : `Fuzzy Map ${slotCounter - 1}`;
    const newSlot: ControlSlot = {
      id,
      label,
      kind,
      binding: lastParsed.binding,
      scope: 'all',
      targetId: kind === 'boolean' ? buttonTargets[0]?.id : continuousTargets[0]?.id,
      lastRaw: lastParsed.raw,
      lastNormalized: lastParsed.normalized,
      lastUpdated: Date.now(),
    };
    slots = [newSlot, ...slots];
    infoMessage = `${label} 绑定到 ${describeBinding(lastParsed.binding)}`;
    persistSlots();
  }

  function assignBinding(slotId: string, binding: MidiBinding) {
    updateSlot(slotId, (slot) => ({
      ...slot,
      binding,
      lastRaw: undefined,
      lastNormalized: undefined,
      lastApplied: undefined,
    }));
    persistSlots();
  }

  function clearBinding(slotId: string) {
    updateSlot(slotId, (slot) => ({
      ...slot,
      binding: undefined,
      lastRaw: undefined,
      lastNormalized: undefined,
      lastApplied: undefined,
    }));
    persistSlots();
  }

  function updateSlot(id: string, updater: (slot: ControlSlot) => ControlSlot) {
    slots = slots.map((slot) => (slot.id === id ? updater(slot) : slot));
  }

  function applyMapping(slotId: string, parsed: ParsedMessage) {
    const slot = slots.find((s) => s.id === slotId);
    if (!slot || !slot.targetId) return;

    if (slot.kind === 'boolean' && !parsed.isPress) {
      // Trigger on press only
      return;
    }

    const scope = slot.scope ?? 'selected';
    const continuousTarget = continuousTargets.find((t) => t.id === slot.targetId);
    const buttonTarget = buttonTargets.find((t) => t.id === slot.targetId);

    if (continuousTarget) {
      const computed = continuousTarget.compute(parsed.normalized);
      if (!computed) return;
      continuousTarget.apply(computed.value, scope);
      updateSlot(slot.id, (s) => ({ ...s, lastApplied: computed.display }));
    } else if (buttonTarget) {
      const label = buttonTarget.onPress(scope);
      updateSlot(slot.id, (s) => ({ ...s, lastApplied: label ?? '' }));
    }
    persistSlots();
  }

  function mapRange(normalized: number, min: number, max: number) {
    return min + clamp01(normalized) * (max - min);
  }

  function clamp01(value: number) {
    if (Number.isNaN(value)) return 0;
    return Math.min(1, Math.max(0, value));
  }

  function describeBinding(binding?: MidiBinding) {
    if (!binding) return 'Not bound';
    if (binding.messageType === 'pitchbend') return `Pitch Bend ch${binding.channel + 1}`;
    return `${binding.messageType.toUpperCase()} ${binding.number} ch${binding.channel + 1}`;
  }

  function describeParsed(parsed: ParsedMessage) {
    if (parsed.binding.messageType === 'pitchbend') {
      return `Pitch Bend ch${parsed.binding.channel + 1} → ${(parsed.normalized * 100).toFixed(0)}%`;
    }
    const num = parsed.binding.number ?? 0;
    const type = parsed.binding.messageType.toUpperCase();
    return `${type} ${num} ch${parsed.binding.channel + 1} → ${(parsed.normalized * 100).toFixed(0)}%`;
  }

  function startLearning(id: string) {
    listeningSlotId = id;
    infoMessage = 'Move or press a control to bind...';
  }

  function setTarget(slotId: string, targetId: string) {
    updateSlot(slotId, (slot) => ({ ...slot, targetId, lastApplied: undefined }));
    persistSlots();
  }

  function setScope(slotId: string, scope: Scope) {
    updateSlot(slotId, (slot) => ({ ...slot, scope }));
    persistSlots();
  }

  function handleInputSelect(event: Event) {
    const selectEl = event.currentTarget as HTMLSelectElement;
    selectInput(selectEl.value);
    persistSlots();
  }

  function handleTargetChange(event: Event, slotId: string) {
    const selectEl = event.currentTarget as HTMLSelectElement;
    setTarget(slotId, selectEl.value);
  }

  function handleScopeChange(event: Event, slotId: string) {
    const selectEl = event.currentTarget as HTMLSelectElement;
    setScope(slotId, selectEl.value as Scope);
  }

  function persistSlots() {
    if (typeof localStorage === 'undefined') return;
    const payload = {
      slots,
      slotCounter,
      selectedInputId,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }

  function hydrateFromStorage() {
    if (typeof localStorage === 'undefined') return;
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed.slots)) {
          slots = parsed.slots.map((s: ControlSlot & { kind?: string }) => ({
            ...s,
            kind:
              s.kind === 'button'
                ? 'boolean'
                : s.kind === 'fader' || s.kind === 'knob'
                  ? 'fuzzy'
                  : (s.kind as SlotKind) ?? 'fuzzy',
            scope: (s.scope as Scope) ?? 'all',
          }));
        }
        slotCounter = parsed.slotCounter ?? (Array.isArray(parsed.slots) ? parsed.slots.length + 1 : 1);
        selectedInputId = parsed.selectedInputId ?? '';
      } catch (err) {
        console.warn('Failed to parse MIDI mapper storage', err);
      }
    }
    // Ensure scopes are not undefined
    slots = slots.map((s) => ({ ...s, scope: s.scope ?? 'all' }));
  }
</script>

<div class="mapper">
  <div class="mapper-header">
    <div>
      <h2>MIDI Mapper · MVAVE SMC Mixer</h2>
      <p class="subtitle">
        显示并映射该控制器的按钮 / 推杆 / 旋钮到 Manager 参数，自动把 MIDI 值归一化到 0–1。
      </p>
    </div>
    <div class="input-select">
      <label>输入</label>
      <select bind:value={selectedInputId} on:change={handleInputSelect}>
        {#if midiInputs.length === 0}
          <option value="">No MIDI inputs</option>
        {:else}
          {#each midiInputs as input}
            <option value={input.id}>{input.name}</option>
          {/each}
        {/if}
      </select>
      <Button variant="secondary" size="sm" on:click={refreshInputs}>Refresh</Button>
    </div>
  </div>

  {#if errorMessage}
    <div class="alert error">{errorMessage}</div>
  {/if}
  {#if infoMessage}
    <div class="alert info">{infoMessage}</div>
  {/if}

  <div class="status-grid">
    <div class="card">
      <div class="card-title">最近的 MIDI</div>
      <div class="card-body">
        <div class="stat-label">Last message</div>
        <div class="stat-value">{lastMessageBrief || '—'}</div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">映射规则提示</div>
      <div class="card-body tips">
        <p>· 按钮类目标只允许按钮控制；连续型目标只允许推杆/旋钮。</p>
        <p>· 频率、Clients 等非 0–1 参数会自动按 0–1 重新映射，右侧会显示原始值。</p>
        <p>· Clients 列表变化时会重新计算映射，避免选中已退出的客户端。</p>
      </div>
    </div>
  </div>

  <section class="controls">
    <div class="section-head">
      <h3>Boolean（按钮逻辑）</h3>
      <Button size="sm" variant="secondary" on:click={() => addSlot('boolean')}>
        ＋ 使用最近 MIDI
      </Button>
    </div>
    {#if slots.filter((s) => s.kind === 'boolean').length === 0}
      <div class="empty">暂无映射，先按一次控制器按钮再点“＋”。</div>
    {:else}
      <div class="control-grid">
        {#each slots.filter((s) => s.kind === 'boolean') as slot (slot.id)}
          <div class="control-card" aria-label={`MIDI control ${slot.label}`}>
            <div class="control-header">
              <div>
                <div class="control-title">{slot.label}</div>
                <div class="control-binding">{describeBinding(slot.binding)}</div>
              </div>
              <div class="control-actions">
                <Button size="sm" variant="ghost" on:click={() => startLearning(slot.id)}>重学</Button>
                <Button
                  size="sm"
                  variant="ghost"
                  on:click={() => clearBinding(slot.id)}
                  disabled={!slot.binding}
                >
                  清除
                </Button>
              </div>
            </div>

            <div class="control-body">
              <div class="value-block">
                <div class="label">值 (0–1)</div>
                <div class="value">{slot.lastNormalized?.toFixed(2) ?? '—'}</div>
                {#if slot.lastRaw !== undefined}
                  <div class="mini">raw: {slot.lastRaw}</div>
                {/if}
              </div>

              <div class="mapping-block">
                <label>映射到</label>
                <select bind:value={slot.targetId} on:change={(e) => handleTargetChange(e, slot.id)}>
                  <option value="">未设置</option>
                  {#each buttonTargets as target}
                    <option value={target.id}>{target.label}</option>
                  {/each}
                </select>

                <div class="scope-row">
                  <label>作用范围</label>
                  <select bind:value={slot.scope} on:change={(e) => handleScopeChange(e, slot.id)}>
                    <option value="selected">Selected clients</option>
                    <option value="all">All clients</option>
                  </select>
                </div>

                {#if slot.lastApplied}
                  <div class="applied">原始参数: {slot.lastApplied}</div>
                {/if}
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}

    <div class="section-head">
      <h3>Fuzzy（0–1 连续映射）</h3>
      <Button size="sm" variant="secondary" on:click={() => addSlot('fuzzy')}>
        ＋ 使用最近 MIDI
      </Button>
    </div>
    {#if slots.filter((s) => s.kind === 'fuzzy').length === 0}
      <div class="empty">暂无映射，先拨动推杆/旋钮，再点“＋”。</div>
    {:else}
      <div class="control-grid">
        {#each slots.filter((s) => s.kind === 'fuzzy') as slot (slot.id)}
          <div class="control-card" aria-label={`MIDI control ${slot.label}`}>
            <div class="control-header">
              <div>
                <div class="control-title">{slot.label}</div>
                <div class="control-binding">{describeBinding(slot.binding)}</div>
              </div>
              <div class="control-actions">
                <Button size="sm" variant="ghost" on:click={() => startLearning(slot.id)}>重学</Button>
                <Button
                  size="sm"
                  variant="ghost"
                  on:click={() => clearBinding(slot.id)}
                  disabled={!slot.binding}
                >
                  清除
                </Button>
              </div>
            </div>

            <div class="control-body">
              <div class="value-block">
                <div class="label">值 (0–1)</div>
                <div class="value">{slot.lastNormalized?.toFixed(2) ?? '—'}</div>
                {#if slot.lastRaw !== undefined}
                  <div class="mini">raw: {slot.lastRaw}</div>
                {/if}
              </div>

              <div class="mapping-block">
                <label>映射到</label>
                <select bind:value={slot.targetId} on:change={(e) => handleTargetChange(e, slot.id)}>
                  <option value="">未设置</option>
                  {#each continuousTargets as target}
                    <option value={target.id}>{target.label}</option>
                  {/each}
                </select>

                <div class="scope-row">
                  <label>作用范围</label>
                  <select bind:value={slot.scope} on:change={(e) => handleScopeChange(e, slot.id)}>
                    <option value="selected">Selected clients</option>
                    <option value="all">All clients</option>
                  </select>
                </div>

                {#if slot.lastApplied}
                  <div class="applied">原始参数: {slot.lastApplied}</div>
                {/if}
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </section>
</div>

<style>
  .mapper {
    display: flex;
    flex-direction: column;
    gap: var(--space-lg);
  }

  .mapper-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-lg);
  }

  .subtitle {
    color: var(--text-secondary);
    margin-top: 4px;
  }

  .input-select {
    display: flex;
    gap: var(--space-sm);
    align-items: center;
  }

  select {
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    color: var(--text-primary);
    padding: 8px 10px;
    border-radius: var(--radius-sm);
  }

  .alert {
    padding: var(--space-sm) var(--space-md);
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
  }

  .alert.error {
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid var(--color-error);
  }

  .alert.info {
    background: rgba(94, 234, 212, 0.08);
    border: 1px solid var(--color-secondary);
  }

  .status-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: var(--space-md);
  }

  .card {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: var(--space-md);
  }

  .card-title {
    font-weight: 600;
    margin-bottom: var(--space-sm);
  }

  .card-body {
    color: var(--text-primary);
  }

  .tips p {
    margin: 6px 0;
    color: var(--text-secondary);
  }

  .stat-label {
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .stat-value {
    font-family: var(--font-mono);
    font-size: var(--text-base);
  }

  .controls h3 {
    margin: var(--space-md) 0 var(--space-sm);
  }

  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-sm);
    margin-top: var(--space-lg);
  }

  .empty {
    padding: var(--space-md);
    border: 1px dashed var(--border-color);
    border-radius: var(--radius-md);
    color: var(--text-secondary);
  }

  .control-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: var(--space-md);
  }

  .control-card {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: var(--space-md);
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
  }

  .control-header {
    display: flex;
    justify-content: space-between;
    gap: var(--space-sm);
  }

  .control-title {
    font-weight: 600;
  }

  .control-binding {
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .control-actions {
    display: flex;
    gap: var(--space-xs);
  }

  .control-body {
    display: grid;
    grid-template-columns: 120px 1fr;
    gap: var(--space-md);
    align-items: start;
  }

  .value-block {
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
    padding: var(--space-sm);
  }

  .value-block .label {
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .value-block .value {
    font-family: var(--font-mono);
    font-size: var(--text-lg);
  }

  .value-block .mini {
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .mapping-block {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .scope-row {
    display: flex;
    gap: var(--space-sm);
    align-items: center;
  }

  .applied {
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  @media (max-width: 720px) {
    .control-body {
      grid-template-columns: 1fr;
    }
  }
</style>
