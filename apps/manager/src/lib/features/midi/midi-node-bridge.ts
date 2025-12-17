/**
 * MIDI-Node Bridge
 * Provides MIDI learn + last-value lookup for Node Graph MIDI nodes.
 */
import { writable, get, type Writable } from 'svelte/store';
import { midiService, type MidiEvent } from './midi-service';
import { nodeEngine } from '$lib/nodes';

export interface MidiSource {
  inputId?: string;
  type: 'cc' | 'note' | 'pitchbend';
  channel: number;
  number?: number;
}

export type MidiNodeLearnMode = { active: boolean; nodeId: string | null };

export function midiSourceMatchesEvent(
  source: MidiSource | null | undefined,
  event: MidiEvent,
  selectedInputId: string | null | undefined = null
): boolean {
  if (!source) return false;
  // Exact device binding takes priority; otherwise fall back to the UI-selected device (legacy behavior).
  if (source.inputId) {
    if (source.inputId !== event.inputId) return false;
  } else if (selectedInputId) {
    if (event.inputId !== selectedInputId) return false;
  }

  if (source.type !== event.type) return false;
  if (source.channel !== event.channel) return false;
  if (source.type !== 'pitchbend' && source.number !== event.number) return false;
  return true;
}

function sourceKey(source: MidiSource): string {
  const input = source.inputId ? `in:${source.inputId}` : 'in:*';
  const number = source.type === 'pitchbend' ? 'pb' : String(source.number ?? 0);
  return `${input}|${source.type}|ch:${source.channel}|num:${number}`;
}

function sourceFromEvent(event: MidiEvent): MidiSource {
  return {
    inputId: event.inputId,
    type: event.type,
    channel: event.channel,
    number: event.type === 'pitchbend' ? undefined : event.number,
  };
}

class MidiNodeBridgeClass {
  public learnMode: Writable<MidiNodeLearnMode> = writable({ active: false, nodeId: null });

  private unsubscribeMidi: (() => void) | null = null;
  private lastBySourceKey = new Map<string, MidiEvent>();

  init(): void {
    if (this.unsubscribeMidi) return;
    this.unsubscribeMidi = midiService.onMessage((event) => this.handleMidiEvent(event));
  }

  destroy(): void {
    this.unsubscribeMidi?.();
    this.unsubscribeMidi = null;
    this.lastBySourceKey.clear();
    this.learnMode.set({ active: false, nodeId: null });
  }

  startLearn(nodeId: string): void {
    this.learnMode.set({ active: true, nodeId });
  }

  cancelLearn(): void {
    this.learnMode.set({ active: false, nodeId: null });
  }

  getEvent(source: MidiSource | null | undefined): MidiEvent | null {
    if (!source) return null;
    const key = sourceKey(source);
    return this.lastBySourceKey.get(key) ?? null;
  }

  getNormalized(source: MidiSource | null | undefined): number | null {
    const event = this.getEvent(source);
    if (!event) return null;
    return event.normalized;
  }

  private handleMidiEvent(event: MidiEvent): void {
    const source = sourceFromEvent(event);
    this.lastBySourceKey.set(sourceKey(source), event);

    const learn = get(this.learnMode);
    if (!learn.active || !learn.nodeId) return;

    // Respect currently selected input to avoid capturing the wrong device.
    const selectedInputId = get(midiService.selectedInputId);
    if (selectedInputId && event.inputId !== selectedInputId) return;

    nodeEngine.updateNodeConfig(learn.nodeId, { source });
    this.cancelLearn();
  }
}

export const midiNodeBridge = new MidiNodeBridgeClass();

export function formatMidiSource(source: MidiSource | null | undefined): string {
  if (!source) return 'Unbound';
  const input = source.inputId ? `in:${source.inputId}` : 'in:*';
  const channel = `ch${source.channel + 1}`;
  if (source.type === 'pitchbend') return `${input} • pitchbend • ${channel}`;
  const number = source.number ?? 0;
  return `${input} • ${source.type} ${number} • ${channel}`;
}
