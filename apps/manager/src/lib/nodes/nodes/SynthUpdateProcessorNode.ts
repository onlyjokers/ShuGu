/**
 * SynthUpdateProcessorNode
 * Builds a `modulateSoundUpdate` command from config.
 *
 * Note: this updates an already-playing sound on the client.
 */
import type { NodeDefinition } from '../types';
import { nodeRegistry } from '../registry';

const WAVEFORM_OPTIONS = [
  { value: 'square', label: 'Square' },
  { value: 'sine', label: 'Sine' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'sawtooth', label: 'Sawtooth' },
] as const satisfies { value: string; label: string }[];

const SynthUpdateProcessorNode: NodeDefinition = {
  type: 'proc-synth-update',
  label: 'Synth (Update)',
  category: 'Processors',
  inputs: [
    { id: 'client', label: 'Client', type: 'client' },
    { id: 'waveform', label: 'Wave', type: 'fuzzy' },
    { id: 'frequency', label: 'Freq', type: 'number' },
    { id: 'volume', label: 'Vol', type: 'number' },
    { id: 'modDepth', label: 'Depth', type: 'number' },
    { id: 'modFrequency', label: 'Rate', type: 'number' },
    { id: 'durationMs', label: 'Dur', type: 'number' },
  ],
  outputs: [{ id: 'cmd', label: 'Cmd', type: 'command' }],
  configSchema: [
    { key: 'frequency', label: 'Freq (Hz)', type: 'number', defaultValue: 180 },
    { key: 'volume', label: 'Volume', type: 'number', defaultValue: 0.7 },
    {
      key: 'waveform',
      label: 'Waveform',
      type: 'select',
      defaultValue: 'square',
      options: WAVEFORM_OPTIONS,
    },
    { key: 'modDepth', label: 'Wobble Depth', type: 'number', defaultValue: 0 },
    { key: 'modFrequency', label: 'Wobble Rate (Hz)', type: 'number', defaultValue: 12 },
    { key: 'durationMs', label: 'Dur (ms)', type: 'number', defaultValue: 200 },
  ],
  process: (inputs, config) => {
    const client = inputs.client as any;
    if (!client?.clientId) return { cmd: null };

    const frequency =
      typeof inputs.frequency === 'number'
        ? (inputs.frequency as number)
        : Number(config.frequency ?? 180);
    const volume =
      typeof inputs.volume === 'number' ? (inputs.volume as number) : Number(config.volume ?? 0.7);
    const depthRaw =
      typeof inputs.modDepth === 'number' ? (inputs.modDepth as number) : Number(config.modDepth ?? 0);
    const depth = Math.max(0, Math.min(1, depthRaw));
    const modFrequency =
      typeof inputs.modFrequency === 'number'
        ? (inputs.modFrequency as number)
        : Number(config.modFrequency ?? 12);
    const durationMs =
      typeof inputs.durationMs === 'number'
        ? (inputs.durationMs as number)
        : Number(config.durationMs ?? 200);

    const fallbackWaveform = String(config.waveform ?? 'square');
    const waveform = (() => {
      const v = inputs.waveform;
      if (typeof v !== 'number' || !Number.isFinite(v)) return fallbackWaveform;
      const options = WAVEFORM_OPTIONS.map((o) => o.value);
      const clamped = Math.max(0, Math.min(1, v));
      const idx = Math.min(options.length - 1, Math.floor(clamped * options.length));
      return options[idx] ?? fallbackWaveform;
    })();

    return {
      cmd: {
        action: 'modulateSoundUpdate',
        payload: {
          frequency,
          volume: Math.max(0, Math.min(1, volume)),
          waveform,
          modDepth: depth > 0 ? depth : undefined,
          modFrequency: depth > 0 ? modFrequency : undefined,
          durationMs,
        },
      },
    };
  },
};

nodeRegistry.register(SynthUpdateProcessorNode);

export default SynthUpdateProcessorNode;
