/**
 * MidiColorMapNode
 * Maps a fuzzy (0..1) signal into a color between two endpoints.
 */
import type { NodeDefinition } from '../types';
import { nodeRegistry } from '../registry';

type Rgb = { r: number; g: number; b: number };

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function parseHexColor(value: unknown): Rgb | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  const hex = raw.startsWith('#') ? raw.slice(1) : raw;

  const isShort = hex.length === 3;
  const isFull = hex.length === 6;
  if (!isShort && !isFull) return null;
  if (!/^[0-9a-fA-F]+$/.test(hex)) return null;

  const full = isShort ? hex.split('').map((c) => c + c).join('') : hex;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if (![r, g, b].every((n) => Number.isFinite(n))) return null;
  return { r, g, b };
}

function toHex({ r, g, b }: Rgb): string {
  const cl = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return (
    '#' +
    [cl(r), cl(g), cl(b)]
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('')
      .toLowerCase()
  );
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

const MidiColorMapNode: NodeDefinition = {
  type: 'midi-color-map',
  label: 'Color Mapping',
  category: 'MIDI',
  inputs: [{ id: 'in', label: 'In', type: 'fuzzy', defaultValue: 0 }],
  outputs: [{ id: 'out', label: 'Out', type: 'color' }],
  configSchema: [
    { key: 'from', label: 'From', type: 'string', defaultValue: '#6366f1' },
    { key: 'to', label: 'To', type: 'string', defaultValue: '#ffffff' },
    { key: 'invert', label: 'Invert', type: 'boolean', defaultValue: false },
  ],
  process: (inputs, config) => {
    const raw = typeof inputs.in === 'number' ? (inputs.in as number) : 0;
    const invert = Boolean(config.invert);
    const t = invert ? 1 - clamp01(raw) : clamp01(raw);

    const fromRaw = config.from ?? '#6366f1';
    const toRaw = config.to ?? '#ffffff';
    const from = parseHexColor(fromRaw) ?? parseHexColor('#6366f1');
    const to = parseHexColor(toRaw) ?? parseHexColor('#ffffff');
    if (!from || !to) return { out: null };

    const out: Rgb = {
      r: lerp(from.r, to.r, t),
      g: lerp(from.g, to.g, t),
      b: lerp(from.b, to.b, t),
    };
    return { out: toHex(out) };
  },
};

nodeRegistry.register(MidiColorMapNode);

export default MidiColorMapNode;

