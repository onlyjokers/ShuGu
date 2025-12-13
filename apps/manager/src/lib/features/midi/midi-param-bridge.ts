/**
 * MIDI-Parameter Bridge
 * Connects MIDI events to Registry Parameters and other manager targets (e.g. client selection)
 * with dual-mode mapping where applicable.
 */
import { writable, get, type Writable } from 'svelte/store';
import { midiService, type MidiEvent } from './midi-service';
import { mapRangeWithOptions } from './midi-math';
import { parameterRegistry } from '../../parameters/registry';
import type { Parameter } from '../../parameters/parameter';
import { state, selectClients } from '$lib/stores/manager';

export type MidiBindingMode = 'REMOTE' | 'MODULATION';

export interface MidiSource {
  inputId?: string;
  type: 'cc' | 'note' | 'pitchbend';
  channel: number;
  number?: number;  // CC number or note number (undefined for pitchbend)
}

export type MidiTarget =
  | { type: 'PARAM'; path: string }
  | { type: 'CLIENT_RANGE' }
  | { type: 'CLIENT_OBJECT' };

export interface MidiBinding {
  id: string;
  source: MidiSource;
  target: MidiTarget;
  mode: MidiBindingMode;
  mapping: {
    min: number;
    max: number;
    invert: boolean;
  };
  lastValue?: number;
  lastTimestamp?: number;
  lastSelection?: string[];
}

const STORAGE_KEY = 'midi-param-bindings-v1';

class MidiParamBridgeClass {
  public bindings: Writable<MidiBinding[]> = writable([]);
  public learnMode: Writable<{ active: boolean; target: MidiTarget | null; defaultMode: MidiBindingMode }> = writable({
    active: false,
    target: null,
    defaultMode: 'REMOTE',
  });
  
  private unsubscribeMidi: (() => void) | null = null;
  private bindingIdCounter = 0;

  init(): void {
    this.loadFromStorage();
    this.unsubscribeMidi = midiService.onMessage((event) => this.handleMidiEvent(event));
  }

  destroy(): void {
    if (this.unsubscribeMidi) {
      this.unsubscribeMidi();
    }
  }

  /**
   * Start MIDI Learn mode for a specific parameter
   */
  startLearn(target: MidiTarget, defaultMode: MidiBindingMode = 'REMOTE'): void {
    this.learnMode.set({ active: true, target, defaultMode });
  }

  /**
   * Cancel MIDI Learn mode
   */
  cancelLearn(): void {
    this.learnMode.set({ active: false, target: null, defaultMode: 'REMOTE' });
  }

  /**
   * Add a binding manually
   */
  addBinding(binding: Omit<MidiBinding, 'id'>): MidiBinding {
    const id = `binding-${++this.bindingIdCounter}-${Date.now()}`;
    const newBinding: MidiBinding = { ...binding, id };
    
    this.bindings.update((list) => [...list, newBinding]);
    this.saveToStorage();
    return newBinding;
  }

  /**
   * Remove a binding
   */
  removeBinding(id: string): void {
    const binding = get(this.bindings).find((b) => b.id === id);
    if (binding && binding.mode === 'MODULATION' && binding.target.type === 'PARAM') {
      // Clear the modulation offset
      const param = parameterRegistry.get(binding.target.path);
      if (param) {
        param.clearModulation(`midi-${id}`, 'MIDI');
      }
    }
    
    this.bindings.update((list) => list.filter((b) => b.id !== id));
    this.saveToStorage();
  }

  /**
   * Update binding properties
   */
  updateBinding(id: string, updates: Partial<Omit<MidiBinding, 'id'>>): void {
    this.bindings.update((list) =>
      list.map((b) => (b.id === id ? { ...b, ...updates } : b))
    );
    this.saveToStorage();
  }

  /**
   * Toggle binding mode between REMOTE and MODULATION
   */
  toggleMode(id: string): void {
    const binding = get(this.bindings).find((b) => b.id === id);
    if (!binding) return;
    if (binding.target.type !== 'PARAM') return;

    const newMode: MidiBindingMode = binding.mode === 'REMOTE' ? 'MODULATION' : 'REMOTE';
    
    // If switching from MODULATION to REMOTE, clear the modulation offset
    if (binding.mode === 'MODULATION') {
      const param = parameterRegistry.get(binding.target.path);
      if (param) {
        param.clearModulation(`midi-${id}`, 'MIDI');
      }
    }

    this.updateBinding(id, { mode: newMode });
  }

  private handleMidiEvent(event: MidiEvent): void {
    const learn = get(this.learnMode);
    
    // Handle Learn Mode
    if (learn.active && learn.target) {
      // For learning, respect the currently selected input in the UI to avoid capturing the wrong device.
      const selectedInputId = get(midiService.selectedInputId);
      if (selectedInputId && event.inputId !== selectedInputId) {
        return;
      }
      this.handleLearn(event, learn.target, learn.defaultMode);
      return;
    }

    // Handle normal bindings
    const bindings = get(this.bindings);
    for (const binding of bindings) {
      if (this.sourceMatches(binding.source, event)) {
        this.applyBinding(binding, event);
      }
    }
  }

  private handleLearn(event: MidiEvent, target: MidiTarget, defaultMode: MidiBindingMode): void {
    const mode = target.type === 'PARAM' ? defaultMode : 'REMOTE';

    // For PARAM targets, read min/max metadata. For non-params, use a normalized 0..1 mapping.
    const min =
      target.type === 'PARAM' ? (parameterRegistry.get(target.path)?.min ?? 0) : 0;
    const max =
      target.type === 'PARAM' ? (parameterRegistry.get(target.path)?.max ?? 1) : 1;

    const source: MidiSource = {
      inputId: event.inputId,
      type: event.type,
      channel: event.channel,
      number: event.number,
    };

    // Check if binding already exists for this source
    const existing = get(this.bindings).find((b) => this.sourceMatches(b.source, event));
    if (existing) {
      // Update existing binding's target
      this.updateBinding(existing.id, { target, mode, mapping: { min, max, invert: false } });
    } else {
      // Create new binding
      this.addBinding({
        source,
        target,
        mode,
        mapping: { min, max, invert: false },
      });
    }

    this.cancelLearn();
  }

  private sourceMatches(source: MidiSource, event: MidiEvent): boolean {
    // Backward compat: old bindings without inputId should behave like the old "single active input" model
    // and only match the currently selected input in the UI.
    const selectedInputId = get(midiService.selectedInputId);
    if (source.inputId) {
      if (source.inputId !== event.inputId) return false;
    } else if (selectedInputId && event.inputId !== selectedInputId) {
      return false;
    }
    if (source.type !== event.type) return false;
    if (source.channel !== event.channel) return false;
    if (source.type !== 'pitchbend' && source.number !== event.number) return false;
    return true;
  }

  private applyBinding(binding: MidiBinding, event: MidiEvent): void {
    if (binding.target.type === 'PARAM') {
      const param = parameterRegistry.get(binding.target.path) as Parameter<number> | undefined;
      if (!param) return;

      const { min, max, invert } = binding.mapping;
      const mappedValue = mapRangeWithOptions(event.normalized, min, max, invert);

      // Update binding state
      this.bindings.update((list) =>
        list.map((b) =>
          b.id === binding.id
            ? { ...b, lastValue: mappedValue, lastTimestamp: event.timestamp }
            : b
        )
      );

      if (binding.mode === 'REMOTE') {
        // REMOTE: Set the base value (UI slider handle moves)
        param.setValue(mappedValue, 'MIDI');
      } else {
        // MODULATION: Add offset (only effective bar moves)
        // Calculate offset as difference from base
        const offset = mappedValue - param.baseValue;
        param.setModulation(`midi-${binding.id}`, offset, 'MIDI');
      }
      return;
    }

    // Non-parameter targets (selection, etc.)
    const nextNormalized = binding.mapping.invert ? 1 - event.normalized : event.normalized;
    const clients = get(state).clients.map((c) => c.clientId);
    if (clients.length === 0) return;

    let nextSelection: string[] = [];
    if (binding.target.type === 'CLIENT_RANGE') {
      const count = Math.min(clients.length, Math.floor(nextNormalized * (clients.length + 1)));
      nextSelection = clients.slice(0, count);
    } else if (binding.target.type === 'CLIENT_OBJECT') {
      const idx = Math.min(clients.length - 1, Math.floor(nextNormalized * clients.length));
      nextSelection = [clients[idx]];
    }

    const prevSelection = binding.lastSelection ?? [];
    const isSame =
      prevSelection.length === nextSelection.length &&
      prevSelection.every((id, i) => id === nextSelection[i]);

    // Update binding state and apply selection if it changed
    this.bindings.update((list) =>
      list.map((b) =>
        b.id === binding.id
          ? {
              ...b,
              lastValue: nextNormalized,
              lastTimestamp: event.timestamp,
              lastSelection: nextSelection,
            }
          : b
      )
    );

    if (!isSame) {
      selectClients(nextSelection);
    }
  }

  private saveToStorage(): void {
    if (typeof localStorage === 'undefined') return;
    const data = {
      bindings: get(this.bindings),
      counter: this.bindingIdCounter,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  private loadFromStorage(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        if (Array.isArray(data.bindings)) {
          const migrated = data.bindings
            .map((raw: any) => this.migrateBinding(raw))
            .filter((b: MidiBinding | null) => Boolean(b)) as MidiBinding[];
          this.bindings.set(migrated);
        }
        if (typeof data.counter === 'number') {
          this.bindingIdCounter = data.counter;
        }
      }
    } catch (err) {
      console.warn('[MidiParamBridge] Failed to load bindings:', err);
    }
  }

  private migrateBinding(raw: any): MidiBinding | null {
    if (!raw || typeof raw !== 'object') return null;
    // Legacy shape: { targetPath: string }
    if (!raw.target && typeof raw.targetPath === 'string') {
      raw.target = { type: 'PARAM', path: raw.targetPath } satisfies MidiTarget;
      delete raw.targetPath;
    }
    if (!raw.target || typeof raw.target !== 'object') return null;
    if (typeof raw.id !== 'string' || !raw.source) return null;
    // Default mapping for older or partial entries
    if (!raw.mapping) raw.mapping = { min: 0, max: 1, invert: false };
    if (!raw.mode) raw.mode = 'REMOTE';
    return raw as MidiBinding;
  }
}

// Singleton instance
export const midiParamBridge = new MidiParamBridgeClass();
