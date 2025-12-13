/**
 * MIDI Service - Singleton managing WebMIDI lifecycle
 * Provides unified event format and stores for UI monitoring.
 */
import { writable, type Writable } from 'svelte/store';
import { normalizeMidi } from './midi-math';

export interface MidiEvent {
  inputId: string;
  type: 'cc' | 'note' | 'pitchbend';
  channel: number;
  number?: number;  // CC number or note number
  rawValue: number;
  normalized: number;
  isPress?: boolean;  // For notes
  timestamp: number;
}

export interface MidiInput {
  id: string;
  name: string;
}

type MidiMessageHandler = (event: MidiEvent) => void;

class MidiServiceClass {
  private access: MIDIAccess | null = null;
  private activeInputId: string | null = null;
  private boundInputIds: Set<string> = new Set();
  private handlers: Set<MidiMessageHandler> = new Set();
  
  // Stores for UI
  public inputs: Writable<MidiInput[]> = writable([]);
  public selectedInputId: Writable<string> = writable('');
  public lastMessage: Writable<MidiEvent | null> = writable(null);
  public isSupported: Writable<boolean> = writable(false);
  public error: Writable<string | null> = writable(null);

  async init(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !navigator.requestMIDIAccess) {
      this.error.set('WebMIDI not supported in this browser');
      this.isSupported.set(false);
      return false;
    }

    try {
      this.access = await navigator.requestMIDIAccess();
      this.isSupported.set(true);
      this.refreshInputs();
      
      this.access.onstatechange = () => this.refreshInputs();
      return true;
    } catch (err) {
      this.error.set('Failed to get MIDI access permission');
      this.isSupported.set(false);
      return false;
    }
  }

  private refreshInputs(): void {
    if (!this.access) return;
    
    const inputList: MidiInput[] = [];
    this.access.inputs.forEach((input) => {
      inputList.push({ id: input.id, name: input.name || `MIDI Device ${input.id}` });

      // Listen to all inputs so different bindings can map to different devices.
      if (!this.boundInputIds.has(input.id)) {
        input.onmidimessage = (e) => this.handleMidiMessage(e, input.id);
        this.boundInputIds.add(input.id);
      }
    });
    
    this.inputs.set(inputList);
    
    // Auto-select first input if none selected
    if (!this.activeInputId && inputList.length > 0) {
      this.selectInput(inputList[0].id);
    }
  }

  selectInput(id: string): void {
    if (!this.access) return;

    // Selection is used for UI monitor and for scoping MIDI learn.
    const input = this.access.inputs.get(id);
    if (!input) return;
    this.activeInputId = id;
    this.selectedInputId.set(id);
  }

  private handleMidiMessage(e: MIDIMessageEvent, inputId: string): void {
    const [status, data1 = 0, data2 = 0] = e.data || [];
    const command = status & 0xf0;
    const channel = status & 0x0f;
    
    let event: MidiEvent | null = null;

    // Note On/Off
    if (command === 0x90 || command === 0x80) {
      const velocity = command === 0x80 ? 0 : data2;
      event = {
        inputId,
        type: 'note',
        channel,
        number: data1,
        rawValue: velocity,
        normalized: normalizeMidi(velocity),
        isPress: velocity > 0,
        timestamp: Date.now(),
      };
    }
    // Control Change
    else if (command === 0xb0) {
      event = {
        inputId,
        type: 'cc',
        channel,
        number: data1,
        rawValue: data2,
        normalized: normalizeMidi(data2),
        timestamp: Date.now(),
      };
    }
    // Pitch Bend
    else if (command === 0xe0) {
      const value14 = data1 + (data2 << 7);
      event = {
        inputId,
        type: 'pitchbend',
        channel,
        rawValue: value14,
        normalized: value14 / 16383,
        timestamp: Date.now(),
      };
    }

    if (event) {
      this.lastMessage.set(event);
      this.handlers.forEach((handler) => {
        try {
          handler(event!);
        } catch (err) {
          console.error('[MidiService] Handler error:', err);
        }
      });
    }
  }

  onMessage(handler: MidiMessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  destroy(): void {
    if (this.access) {
      this.access.inputs.forEach((input) => {
        input.onmidimessage = null;
      });
    }
    this.boundInputIds.clear();
    this.handlers.clear();
  }
}

// Singleton instance
export const midiService = new MidiServiceClass();
