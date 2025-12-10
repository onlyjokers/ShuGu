/**
 * MIDI-Parameter Bridge
 * Connects MIDI events to Registry Parameters with dual-mode mapping.
 */
import { writable, get, type Writable } from 'svelte/store';
import { midiService, type MidiEvent } from './midi-service';
import { mapRangeWithOptions, clamp } from './midi-math';
import { parameterRegistry } from '../../parameters/registry';
import type { Parameter } from '../../parameters/parameter';

export type MidiBindingMode = 'REMOTE' | 'MODULATION';

export interface MidiSource {
  type: 'cc' | 'note' | 'pitchbend';
  channel: number;
  number?: number;  // CC number or note number (undefined for pitchbend)
}

export interface MidiBinding {
  id: string;
  source: MidiSource;
  targetPath: string;
  mode: MidiBindingMode;
  mapping: {
    min: number;
    max: number;
    invert: boolean;
  };
  lastValue?: number;
  lastTimestamp?: number;
}

const STORAGE_KEY = 'midi-param-bindings-v1';

class MidiParamBridgeClass {
  public bindings: Writable<MidiBinding[]> = writable([]);
  public learnMode: Writable<{ active: boolean; targetPath: string | null; defaultMode: MidiBindingMode }> = writable({
    active: false,
    targetPath: null,
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
  startLearn(targetPath: string, defaultMode: MidiBindingMode = 'REMOTE'): void {
    this.learnMode.set({ active: true, targetPath, defaultMode });
  }

  /**
   * Cancel MIDI Learn mode
   */
  cancelLearn(): void {
    this.learnMode.set({ active: false, targetPath: null, defaultMode: 'REMOTE' });
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
    if (binding && binding.mode === 'MODULATION') {
      // Clear the modulation offset
      const param = parameterRegistry.get(binding.targetPath);
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

    const newMode: MidiBindingMode = binding.mode === 'REMOTE' ? 'MODULATION' : 'REMOTE';
    
    // If switching from MODULATION to REMOTE, clear the modulation offset
    if (binding.mode === 'MODULATION') {
      const param = parameterRegistry.get(binding.targetPath);
      if (param) {
        param.clearModulation(`midi-${id}`, 'MIDI');
      }
    }

    this.updateBinding(id, { mode: newMode });
  }

  private handleMidiEvent(event: MidiEvent): void {
    const learn = get(this.learnMode);
    
    // Handle Learn Mode
    if (learn.active && learn.targetPath) {
      this.handleLearn(event, learn.targetPath, learn.defaultMode);
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

  private handleLearn(event: MidiEvent, targetPath: string, defaultMode: MidiBindingMode): void {
    // Get parameter to read min/max metadata
    const param = parameterRegistry.get(targetPath);
    const min = param?.min ?? 0;
    const max = param?.max ?? 1;

    const source: MidiSource = {
      type: event.type,
      channel: event.channel,
      number: event.number,
    };

    // Check if binding already exists for this source
    const existing = get(this.bindings).find((b) => this.sourceMatches(b.source, event));
    if (existing) {
      // Update existing binding's target
      this.updateBinding(existing.id, { targetPath, mapping: { min, max, invert: false } });
    } else {
      // Create new binding
      this.addBinding({
        source,
        targetPath,
        mode: defaultMode,
        mapping: { min, max, invert: false },
      });
    }

    this.cancelLearn();
  }

  private sourceMatches(source: MidiSource, event: MidiEvent): boolean {
    if (source.type !== event.type) return false;
    if (source.channel !== event.channel) return false;
    if (source.type !== 'pitchbend' && source.number !== event.number) return false;
    return true;
  }

  private applyBinding(binding: MidiBinding, event: MidiEvent): void {
    const param = parameterRegistry.get(binding.targetPath) as Parameter<number> | undefined;
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
          this.bindings.set(data.bindings);
        }
        if (typeof data.counter === 'number') {
          this.bindingIdCounter = data.counter;
        }
      }
    } catch (err) {
      console.warn('[MidiParamBridge] Failed to load bindings:', err);
    }
  }
}

// Singleton instance
export const midiParamBridge = new MidiParamBridgeClass();
