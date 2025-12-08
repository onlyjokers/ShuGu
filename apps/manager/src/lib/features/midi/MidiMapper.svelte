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
    groupId?: string;
    targetId?: string;
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
    compute: (normalized: number) => { value: unknown; display: string } | null;
    apply: (value: unknown, scope: Scope) => void;
  };

  type ButtonTarget = {
    id: string;
    label: string;
    onPress: (scope: Scope) => string | void;
  };

  let scopeMode: Scope = 'all';
  let clientSelectionSize = 1;
  let lastClientAnchorIndex = 0;

  // --- Target catalogs with grouping ---
  const continuousTargets: ContinuousTarget[] = [
    {
      id: 'client-scope',
      label: '作用范围（0=选中，1=全部）',
      compute: (normalized) => {
        const nextScope: Scope = normalized >= 0.5 ? 'all' : 'selected';
        return { value: nextScope, display: nextScope === 'all' ? 'All clients' : 'Selected clients' };
      },
      apply: (value, _scope) => {
        if (value === 'all' || value === 'selected') {
          scopeMode = value;
          persistSlots();
        }
      },
    },
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
          value: { clientId: client.clientId, index: idx },
          display: `${formatClientId(client.clientId)} (#${idx + 1}) x${clientSelectionSize}`,
        };
      },
      apply: (value, _scope) => {
        if (!value || $clients.length === 0) return;
        const { clientId, index } =
          typeof value === 'object' && 'clientId' in value
            ? (value as { clientId: string; index: number })
            : (() => {
                const fallbackId = value as string;
                const fallbackIndex = $clients.findIndex((c) => c.clientId === fallbackId);
                return { clientId: fallbackId, index: fallbackIndex };
              })();
        const resolvedIndex =
          index >= 0 ? index : Math.max(0, $clients.findIndex((c) => c.clientId === clientId));
        if (resolvedIndex < 0) return;
        lastClientAnchorIndex = resolvedIndex;
        applySelectionWindow(resolvedIndex);
        updateControlState({});
      },
    },
    {
      id: 'client-range',
      label: '选择范围（人数）',
      compute: (normalized) => {
        const total = $clients.length;
        if (total === 0) return { value: null, display: 'No clients' };
        const maxCount = Math.max(1, Math.floor(total / 2));
        const count = Math.max(1, Math.min(maxCount, Math.round(mapRange(normalized, 1, maxCount))));
        return { value: count, display: `${count} 人` };
      },
      apply: (value, _scope) => {
        if (typeof value !== 'number' || $clients.length === 0) return;
        const maxCount = Math.max(1, Math.floor($clients.length / 2));
        clientSelectionSize = Math.max(1, Math.min(value, maxCount));
        applySelectionWindow(lastClientAnchorIndex);
        persistSlots();
      },
    },
    {
      id: 'synth-freq',
      label: 'Synth Frequency (Hz)',
      compute: (normalized) => {
        const freq = mapRange(normalized, 20, 2000);
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
      id: 'synth-dur',
      label: 'Synth Dur (ms)',
      compute: (normalized) => {
        const dur = Math.round(mapRange(normalized, 50, 2000));
        return { value: dur, display: `${dur} ms` };
      },
      apply: (value, scope) => {
        if (typeof value !== 'number') return;
        modulateSound(
          { duration: value, frequency: 300, volume: 0.6, waveform: 'sine' },
          scope === 'all'
        );
      },
    },
    {
      id: 'synth-vol',
      label: 'Synth Volume',
      compute: (normalized) => {
        const vol = clamp01(normalized);
        return { value: vol, display: `${Math.round(vol * 100)}%` };
      },
      apply: (value, scope) => {
        if (typeof value !== 'number') return;
        modulateSound(
          { volume: value, frequency: 300, duration: 160, waveform: 'sine' },
          scope === 'all'
        );
      },
    },
    {
      id: 'flashlight-freq',
      label: 'Flashlight Freq (Hz, 1=steady)',
      compute: (normalized) => {
        const freq = mapRange(normalized, 0.2, 10);
        return { value: freq, display: `${freq.toFixed(1)} Hz` };
      },
      apply: (value, scope) => {
        if (typeof value !== 'number') return;
        if (value <= 1) {
          flashlight('on', undefined, scope === 'all');
          updateControlState({ flashlightOn: true });
        } else {
          flashlight('blink', { frequency: value, dutyCycle: 0.5 }, scope === 'all');
          updateControlState({ flashlightOn: true });
        }
      },
    },
    {
      id: 'flashlight-duty',
      label: 'Flashlight Duty',
      compute: (normalized) => {
        const duty = mapRange(normalized, 0.1, 0.9);
        return { value: duty, display: `${Math.round(duty * 100)}%` };
      },
      apply: (value, scope) => {
        if (typeof value !== 'number') return;
        flashlight('blink', { frequency: 2, dutyCycle: value }, scope === 'all');
        updateControlState({ flashlightOn: true });
      },
    },
    {
      id: 'flashlight-dur',
      label: 'Flashlight Dur (ms)',
      compute: (normalized) => {
        const dur = Math.round(mapRange(normalized, 0, 8000));
        return { value: dur, display: `${dur} ms` };
      },
      apply: (value, scope) => {
        if (typeof value !== 'number') return;
        flashlight('on', undefined, scope === 'all');
        updateControlState({ flashlightOn: true });
        if (value > 0) {
          setTimeout(() => flashlight('off', undefined, scope === 'all'), value);
        }
      },
    },
    {
      id: 'screen-freq',
      label: 'Screen Freq (Hz)',
      compute: (normalized) => {
        const freq = mapRange(normalized, 0.2, 20);
        return { value: freq, display: `${freq.toFixed(1)} Hz` };
      },
      apply: (value, scope) => {
        if (typeof value !== 'number') return;
        screenColor(
          {
            mode: 'modulate',
            color: '#ffffff',
            secondaryColor: '#ffffff',
            frequencyHz: value,
            minOpacity: 0,
            maxOpacity: 1,
            waveform: 'sine',
          },
          undefined,
          scope === 'all'
        );
      },
    },
    {
      id: 'screen-min',
      label: 'Screen Min Opacity',
      compute: (normalized) => {
        const v = clamp01(normalized);
        return { value: v, display: `${Math.round(v * 100)}%` };
      },
      apply: (value, scope) => {
        if (typeof value !== 'number') return;
        screenColor(
          {
            mode: 'modulate',
            color: '#ffffff',
            secondaryColor: '#ffffff',
            minOpacity: value,
            maxOpacity: 1,
            frequencyHz: 1,
            waveform: 'sine',
          },
          undefined,
          scope === 'all'
        );
      },
    },
    {
      id: 'screen-max',
      label: 'Screen Max Opacity',
      compute: (normalized) => {
        const v = clamp01(normalized);
        return { value: v, display: `${Math.round(v * 100)}%` };
      },
      apply: (value, scope) => {
        if (typeof value !== 'number') return;
        screenColor(
          {
            mode: 'modulate',
            color: '#ffffff',
            secondaryColor: '#ffffff',
            minOpacity: 0,
            maxOpacity: value,
            frequencyHz: 1,
            waveform: 'sine',
          },
          undefined,
          scope === 'all'
        );
      },
    },
    {
      id: 'screen-dur',
      label: 'Screen Dur (ms)',
      compute: (normalized) => {
        const dur = Math.round(mapRange(normalized, 0, 8000));
        return { value: dur, display: `${dur} ms` };
      },
      apply: (value, scope) => {
        if (typeof value !== 'number') return;
        screenColor(
          {
            mode: 'modulate',
            color: '#ffffff',
            secondaryColor: '#ffffff',
            minOpacity: 0,
            maxOpacity: 1,
            frequencyHz: 1,
            waveform: 'sine',
          },
          undefined,
          scope === 'all'
        );
        if (value > 0) {
          setTimeout(() => {
            screenColor(
              { color: 'transparent', opacity: 0, mode: 'solid' },
              undefined,
              scope === 'all'
            );
          }, value);
        }
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
        screenColor(
          { color: '#ffffff', opacity: value, mode: 'solid' },
          undefined,
          scope === 'all'
        );
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
      id: 'flashlight-stop',
      label: 'Flashlight Stop',
      onPress: (scope) => {
        flashlight('off', undefined, scope === 'all');
        updateControlState({ flashlightOn: false });
        return 'Flashlight OFF';
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
      id: 'vibe-stop',
      label: 'Stop Vibration',
      onPress: (scope) => {
        vibrate([], 0, scope === 'all');
        return 'Vibe stop';
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

  const buttonGroups = [
    { id: 'flashlight', label: 'Flashlight', targets: ['flashlight-toggle', 'flashlight-blink', 'flashlight-stop'] },
    { id: 'screen', label: 'Screen', targets: [] },
    { id: 'vibration', label: 'Vibration', targets: ['vibe-pulse', 'vibe-stop'] },
    { id: 'ascii', label: 'ASCII', targets: ['ascii-toggle'] },
    { id: 'scene', label: 'Scene/Media', targets: ['scene-toggle', 'stop-media'] },
  ];

  const continuousGroups = [
    {
      id: 'clients',
      label: 'Clients',
      targets: ['client-selector', 'client-range', 'client-scope'],
    },
    {
      id: 'synth',
      label: 'Synth',
      targets: ['synth-freq', 'synth-dur', 'synth-vol'],
    },
    {
      id: 'flashlight',
      label: 'Flashlight',
      targets: ['flashlight-freq', 'flashlight-duty', 'flashlight-dur'],
    },
    {
      id: 'screen',
      label: 'Screen Color',
      targets: ['screen-freq', 'screen-min', 'screen-max', 'screen-dur', 'screen-opacity'],
    },
    {
      id: 'ascii',
      label: 'ASCII',
      targets: ['ascii-resolution'],
    },
  ];

  let slots: ControlSlot[] = [];
  let slotCounter = 1;

  // Minimal WebMIDI typings (fallback if @types/webmidi not installed)
  type MIDIAccessLite = {
    inputs: Map<string, MIDIInputLite> | any;
    onstatechange: ((ev: any) => void) | null;
  };
  type MIDIInputLite = { id: string; name?: string; onmidimessage: ((e: MIDIMessageEventLite) => void) | null };
  type MIDIMessageEventLite = { data: Uint8Array };

  let midiAccess: MIDIAccessLite | null = null;
  let midiInputs: MIDIInputLite[] = [];
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
    const preferred = midiInputs.find(
      (input) =>
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
    midiAccess.inputs.forEach((input: MIDIInputLite) => {
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

  function parseMessage(event: MIDIMessageEventLite): ParsedMessage | null {
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
      const nature: 'button' | 'continuous' =
        value === 0 || value === 127 ? 'button' : 'continuous';
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

  function handleMidi(event: MIDIMessageEventLite) {
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
    const label =
      kind === 'boolean' ? `Bool Map ${slotCounter - 1}` : `Fuzzy Map ${slotCounter - 1}`;
    const groupId =
      kind === 'boolean' ? buttonGroups[0]?.id : continuousGroups[0]?.id;
    const targetList =
      kind === 'boolean'
        ? buttonGroups.find((g) => g.id === groupId)?.targets ?? []
        : continuousGroups.find((g) => g.id === groupId)?.targets ?? [];
    const newSlot: ControlSlot = {
      id,
      label,
      kind,
      binding: lastParsed.binding,
      groupId,
      targetId: targetList[0],
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

  function applySelectionWindow(anchorIndex: number) {
    if ($clients.length === 0) return;
    const maxCount = Math.max(1, Math.floor($clients.length / 2));
    const count = Math.max(1, Math.min(clientSelectionSize, maxCount, $clients.length));
    const start = Math.min(Math.max(0, anchorIndex), Math.max(0, $clients.length - count));
    const selectedIds = $clients.slice(start, start + count).map((c) => c.clientId);
    selectClients(selectedIds);
  }

  function applyMapping(slotId: string, parsed: ParsedMessage) {
    const slot = slots.find((s) => s.id === slotId);
    if (!slot || !slot.targetId) return;

    if (slot.kind === 'boolean' && !parsed.isPress) {
      // Trigger on press only
      return;
    }

    const scope = scopeMode;
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

  function setGroup(slotId: string, groupId: string) {
    updateSlot(slotId, (slot) => {
      const groups = slot.kind === 'boolean' ? buttonGroups : continuousGroups;
      const targets = groups.find((g) => g.id === groupId)?.targets ?? [];
      return {
        ...slot,
        groupId,
        targetId: targets[0] ?? '',
        lastApplied: undefined,
      };
    });
    persistSlots();
  }

  function handleGroupChange(event: Event, slotId: string) {
    const selectEl = event.currentTarget as HTMLSelectElement;
    setGroup(slotId, selectEl.value);
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

  function persistSlots() {
    if (typeof localStorage === 'undefined') return;
    const payload = {
      slots,
      slotCounter,
      selectedInputId,
      scopeMode,
      clientSelectionSize,
      lastClientAnchorIndex,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }

  function hydrateFromStorage() {
    if (typeof localStorage === 'undefined') return;
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        let legacyScope: Scope | undefined;
        if (Array.isArray(parsed.slots)) {
          slots = parsed.slots.map((s: ControlSlot & { kind?: string; scope?: Scope }) => {
            const { scope: _legacyScope, ...rest } = s;
            if (!legacyScope && (s.scope === 'selected' || s.scope === 'all')) {
              legacyScope = s.scope;
            }
            const rawKind = s.kind as string | undefined;
            const kind: SlotKind =
              rawKind === 'button'
                ? 'boolean'
                : rawKind === 'fader' || rawKind === 'knob'
                  ? 'fuzzy'
                  : ((rawKind as SlotKind) ?? 'fuzzy');
            const groups = kind === 'boolean' ? buttonGroups : continuousGroups;
            const fallbackGroup = groups[0]?.id ?? '';
            const groupId = s.groupId ?? fallbackGroup;
            const targetList = groups.find((g) => g.id === groupId)?.targets ?? [];
            const targetId = s.targetId && targetList.includes(s.targetId)
              ? s.targetId
              : targetList[0] ?? '';
            return {
              ...rest,
              kind,
              groupId,
              targetId,
            };
          });
        }
        slotCounter =
          parsed.slotCounter ?? (Array.isArray(parsed.slots) ? parsed.slots.length + 1 : 1);
        selectedInputId = parsed.selectedInputId ?? '';
        scopeMode = (parsed.scopeMode as Scope) ?? legacyScope ?? 'all';
        clientSelectionSize = Math.max(1, parsed.clientSelectionSize ?? 1);
        lastClientAnchorIndex = Math.max(0, parsed.lastClientAnchorIndex ?? 0);
      } catch (err) {
        console.warn('Failed to parse MIDI mapper storage', err);
      }
    }
  }
</script>

<div class="mapper">
  <div class="mapper-header">
    <div>
      <h2>MIDI Mapper</h2>
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
  </div>

  <section class="controls">
    <div class="section-head">
      <h3>Boolean</h3>
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
                <Button size="sm" variant="ghost" on:click={() => startLearning(slot.id)}
                  >重学</Button
                >
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
                <div class="mapping-selects">
                  <select bind:value={slot.groupId} on:change={(e) => handleGroupChange(e, slot.id)}>
                    {#each buttonGroups as group}
                      <option value={group.id}>{group.label}</option>
                    {/each}
                  </select>
                  <select
                    bind:value={slot.targetId}
                    on:change={(e) => handleTargetChange(e, slot.id)}
                  >
                    <option value="">未设置</option>
                    {#each (buttonGroups.find((g) => g.id === slot.groupId)?.targets ?? []) as tid}
                      {#if buttonTargets.find((t) => t.id === tid)}
                        <option value={tid}>{buttonTargets.find((t) => t.id === tid)?.label}</option>
                      {/if}
                    {/each}
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
      <h3>Fuzzy</h3>
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
                <Button size="sm" variant="ghost" on:click={() => startLearning(slot.id)}
                  >重学</Button
                >
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
                <div class="mapping-selects">
                  <select bind:value={slot.groupId} on:change={(e) => handleGroupChange(e, slot.id)}>
                    {#each continuousGroups as group}
                      <option value={group.id}>{group.label}</option>
                    {/each}
                  </select>
                  <select
                    bind:value={slot.targetId}
                    on:change={(e) => handleTargetChange(e, slot.id)}
                  >
                    <option value="">未设置</option>
                    {#each (continuousGroups.find((g) => g.id === slot.groupId)?.targets ?? []) as tid}
                      {#if continuousTargets.find((t) => t.id === tid)}
                        <option value={tid}>{continuousTargets.find((t) => t.id === tid)?.label}</option>
                      {/if}
                    {/each}
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

.mapping-selects {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-xs);
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
