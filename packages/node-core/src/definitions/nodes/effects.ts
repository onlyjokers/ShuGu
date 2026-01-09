/**
 * Purpose: Effect chain nodes and legacy effect processors.
 */
import type { VisualEffect } from '@shugu/protocol';

import type { NodeDefinition } from '../../types.js';

export function createEffectAsciiNode(): NodeDefinition {
  const coerceEffectChain = (raw: unknown): VisualEffect[] =>
    (Array.isArray(raw) ? raw : []).filter(
      (v): v is VisualEffect =>
        Boolean(v) && typeof v === 'object' && typeof (v as any).type === 'string'
    );

  return {
    type: 'effect-ascii',
    label: 'Effect ASCII',
    category: 'Effect',
    inputs: [
      { id: 'in', label: 'In', type: 'effect' },
      {
        id: 'resolution',
        label: 'Resolution',
        type: 'number',
        defaultValue: 11,
        min: 1,
        max: 100,
        step: 1,
      },
    ],
    outputs: [{ id: 'out', label: 'Out', type: 'effect' }],
    configSchema: [
      {
        key: 'resolution',
        label: 'Resolution',
        type: 'number',
        defaultValue: 11,
        min: 1,
        max: 100,
        step: 1,
      },
    ],
    process: (inputs, config) => {
      const chain = coerceEffectChain(inputs.in);
      const resolution = (() => {
        const fromInput = inputs.resolution;
        const fromConfig = (config as any).resolution;
        const raw =
          typeof fromInput === 'number' ? fromInput : Number(fromInput ?? fromConfig ?? 11);
        const clamped = Number.isFinite(raw) ? Math.max(1, Math.min(100, raw)) : 11;
        return Math.round(clamped);
      })();

      const effect: VisualEffect = { type: 'ascii', cellSize: resolution };
      return { out: [...chain, effect] };
    },
  };
}

export function createEffectConvolutionNode(): NodeDefinition {
  const coerceEffectChain = (raw: unknown): VisualEffect[] =>
    (Array.isArray(raw) ? raw : []).filter(
      (v): v is VisualEffect =>
        Boolean(v) && typeof v === 'object' && typeof (v as any).type === 'string'
    );

  return {
    type: 'effect-convolution',
    label: 'Effect Convolution',
    category: 'Effect',
    inputs: [
      { id: 'in', label: 'In', type: 'effect' },
      { id: 'preset', label: 'Preset', type: 'string' },
      { id: 'mix', label: 'Mix', type: 'number', defaultValue: 1, min: 0, max: 1, step: 0.01 },
      {
        id: 'scale',
        label: 'Scale',
        type: 'number',
        defaultValue: 0.5,
        min: 0.1,
        max: 1,
        step: 0.05,
      },
      { id: 'bias', label: 'Bias', type: 'number', defaultValue: 0, min: -1, max: 1, step: 0.01 },
      { id: 'normalize', label: 'Normalize', type: 'boolean', defaultValue: true },
      { id: 'kernel', label: 'Kernel (3x3)', type: 'string' },
    ],
    outputs: [{ id: 'out', label: 'Out', type: 'effect' }],
    configSchema: [
      {
        key: 'preset',
        label: 'Preset',
        type: 'select',
        defaultValue: 'sharpen',
        options: [
          { value: 'blur', label: 'Blur' },
          { value: 'gaussianBlur', label: 'Gaussian Blur' },
          { value: 'sharpen', label: 'Sharpen' },
          { value: 'edge', label: 'Edge Detect' },
          { value: 'emboss', label: 'Emboss' },
          { value: 'sobelX', label: 'Sobel X' },
          { value: 'sobelY', label: 'Sobel Y' },
          { value: 'custom', label: 'Custom Kernel' },
        ],
      },
      { key: 'mix', label: 'Mix', type: 'number', defaultValue: 1, min: 0, max: 1, step: 0.01 },
      {
        key: 'scale',
        label: 'Scale',
        type: 'number',
        defaultValue: 0.5,
        min: 0.1,
        max: 1,
        step: 0.05,
      },
      { key: 'bias', label: 'Bias', type: 'number', defaultValue: 0, min: -1, max: 1, step: 0.01 },
      { key: 'normalize', label: 'Normalize', type: 'boolean', defaultValue: true },
      { key: 'kernel', label: 'Kernel (3x3)', type: 'string', defaultValue: '' },
    ],
    process: (inputs, config) => {
      const chain = coerceEffectChain(inputs.in);

      const preset = (() => {
        const allowed = [
          'blur',
          'gaussianBlur',
          'sharpen',
          'edge',
          'emboss',
          'sobelX',
          'sobelY',
          'custom',
        ] as const;

        const fromInput = inputs.preset;
        const fromConfig = (config as any).preset;
        const raw =
          typeof fromInput === 'string' && fromInput.trim()
            ? fromInput.trim()
            : typeof fromConfig === 'string' && fromConfig.trim()
              ? fromConfig.trim()
              : 'sharpen';

        return (allowed as readonly string[]).includes(raw) ? raw : 'sharpen';
      })();

      const mix = (() => {
        const fromInput = inputs.mix;
        const fromConfig = (config as any).mix;
        const raw =
          typeof fromInput === 'number' ? fromInput : Number(fromInput ?? fromConfig ?? 1);
        if (!Number.isFinite(raw)) return 1;
        return Math.max(0, Math.min(1, raw));
      })();

      const scale = (() => {
        const fromInput = inputs.scale;
        const fromConfig = (config as any).scale;
        const raw =
          typeof fromInput === 'number' ? fromInput : Number(fromInput ?? fromConfig ?? 0.5);
        if (!Number.isFinite(raw)) return 0.5;
        return Math.max(0.1, Math.min(1, raw));
      })();

      const bias = (() => {
        const fromInput = inputs.bias;
        const fromConfig = (config as any).bias;
        const raw =
          typeof fromInput === 'number' ? fromInput : Number(fromInput ?? fromConfig ?? 0);
        if (!Number.isFinite(raw)) return 0;
        return Math.max(-1, Math.min(1, raw));
      })();

      const normalize = (() => {
        const fromInput = inputs.normalize;
        if (typeof fromInput === 'number' && Number.isFinite(fromInput)) return fromInput >= 0.5;
        if (typeof fromInput === 'boolean') return fromInput;
        const fromConfig = (config as any).normalize;
        if (typeof fromConfig === 'number' && Number.isFinite(fromConfig)) return fromConfig >= 0.5;
        if (typeof fromConfig === 'boolean') return fromConfig;
        return true;
      })();

      const kernel = (() => {
        if (preset !== 'custom') return undefined;
        const fromInput = inputs.kernel;
        const fromConfig = (config as any).kernel;
        const raw =
          typeof fromInput === 'string' && fromInput.trim()
            ? fromInput.trim()
            : typeof fromConfig === 'string' && fromConfig.trim()
              ? fromConfig.trim()
              : '';
        if (!raw) return undefined;

        const parts = raw
          .split(/[\s,]+/g)
          .map((p) => p.trim())
          .filter(Boolean)
          .slice(0, 9);
        if (parts.length !== 9) return undefined;
        const parsed = parts.map((p) => Number(p));
        if (parsed.some((n) => !Number.isFinite(n))) return undefined;
        return parsed;
      })();

      const effect: VisualEffect = {
        type: 'convolution',
        preset: preset as any,
        ...(kernel ? { kernel } : {}),
        mix,
        bias,
        normalize,
        scale,
      };

      return { out: [...chain, effect] };
    },
  };
}

export function createAsciiEffectProcessorNode(): NodeDefinition {
  return {
    type: 'proc-visual-effect-ascii',
    label: 'Legacy Visual Effect-ASCII',
    category: 'Legacy',
    inputs: [
      { id: 'enabled', label: 'Enabled', type: 'boolean', defaultValue: true },
      {
        id: 'resolution',
        label: 'Resolution',
        type: 'number',
        defaultValue: 11,
        min: 1,
        max: 100,
        step: 1,
      },
    ],
    outputs: [{ id: 'cmd', label: 'Cmd', type: 'command' }],
    configSchema: [
      { key: 'enabled', label: 'Enabled', type: 'boolean', defaultValue: true },
      {
        key: 'resolution',
        label: 'Resolution',
        type: 'number',
        defaultValue: 11,
        min: 1,
        max: 100,
        step: 1,
      },
    ],
    process: (inputs, config) => {
      const enabled = (() => {
        const fromInput = inputs.enabled;
        if (typeof fromInput === 'number' && Number.isFinite(fromInput)) return fromInput >= 0.5;
        if (typeof fromInput === 'boolean') return fromInput;
        const fromConfig = (config as any).enabled;
        if (typeof fromConfig === 'number' && Number.isFinite(fromConfig)) return fromConfig >= 0.5;
        if (typeof fromConfig === 'boolean') return fromConfig;
        return true;
      })();

      const resolution = (() => {
        const fromInput = inputs.resolution;
        const fromConfig = (config as any).resolution;
        const raw =
          typeof fromInput === 'number' ? fromInput : Number(fromInput ?? fromConfig ?? 11);
        const clamped = Number.isFinite(raw) ? Math.max(1, Math.min(100, raw)) : 11;
        return Math.round(clamped);
      })();

      return {
        cmd: [
          { action: 'asciiMode', payload: { enabled } },
          { action: 'asciiResolution', payload: { cellSize: resolution } },
        ],
      };
    },
  };
}

export function createConvolutionEffectProcessorNode(): NodeDefinition {
  return {
    type: 'proc-visual-effect-conv',
    label: 'Legacy Visual Effect-Conv',
    category: 'Legacy',
    inputs: [
      { id: 'enabled', label: 'Enabled', type: 'boolean', defaultValue: false },
      { id: 'preset', label: 'Preset', type: 'string' },
      { id: 'mix', label: 'Mix', type: 'number', defaultValue: 1, min: 0, max: 1, step: 0.01 },
      {
        id: 'scale',
        label: 'Scale',
        type: 'number',
        defaultValue: 0.5,
        min: 0.1,
        max: 1,
        step: 0.05,
      },
      { id: 'bias', label: 'Bias', type: 'number', defaultValue: 0, min: -1, max: 1, step: 0.01 },
      { id: 'normalize', label: 'Normalize', type: 'boolean', defaultValue: true },
      { id: 'kernel', label: 'Kernel (3x3)', type: 'string' },
    ],
    outputs: [{ id: 'cmd', label: 'Cmd', type: 'command' }],
    configSchema: [
      { key: 'enabled', label: 'Enabled', type: 'boolean', defaultValue: false },
      {
        key: 'preset',
        label: 'Preset',
        type: 'select',
        defaultValue: 'sharpen',
        options: [
          { value: 'blur', label: 'Blur' },
          { value: 'gaussianBlur', label: 'Gaussian Blur' },
          { value: 'sharpen', label: 'Sharpen' },
          { value: 'edge', label: 'Edge Detect' },
          { value: 'emboss', label: 'Emboss' },
          { value: 'sobelX', label: 'Sobel X' },
          { value: 'sobelY', label: 'Sobel Y' },
          { value: 'custom', label: 'Custom Kernel' },
        ],
      },
      { key: 'mix', label: 'Mix', type: 'number', defaultValue: 1, min: 0, max: 1, step: 0.01 },
      {
        key: 'scale',
        label: 'Scale',
        type: 'number',
        defaultValue: 0.5,
        min: 0.1,
        max: 1,
        step: 0.05,
      },
      { key: 'bias', label: 'Bias', type: 'number', defaultValue: 0, min: -1, max: 1, step: 0.01 },
      { key: 'normalize', label: 'Normalize', type: 'boolean', defaultValue: true },
      { key: 'kernel', label: 'Kernel (3x3)', type: 'string', defaultValue: '' },
    ],
    process: (inputs, config) => {
      const enabled = (() => {
        const fromInput = inputs.enabled;
        if (typeof fromInput === 'number' && Number.isFinite(fromInput)) return fromInput >= 0.5;
        if (typeof fromInput === 'boolean') return fromInput;
        const fromConfig = (config as any).enabled;
        if (typeof fromConfig === 'number' && Number.isFinite(fromConfig)) return fromConfig >= 0.5;
        if (typeof fromConfig === 'boolean') return fromConfig;
        return false;
      })();

      const preset = (() => {
        const allowed = [
          'blur',
          'gaussianBlur',
          'sharpen',
          'edge',
          'emboss',
          'sobelX',
          'sobelY',
          'custom',
        ] as const;

        const fromInput = inputs.preset;
        const fromConfig = (config as any).preset;
        const raw =
          typeof fromInput === 'string' && fromInput.trim()
            ? fromInput.trim()
            : typeof fromConfig === 'string' && fromConfig.trim()
              ? fromConfig.trim()
              : 'sharpen';

        return (allowed as readonly string[]).includes(raw) ? raw : 'sharpen';
      })();

      const mix = (() => {
        const fromInput = inputs.mix;
        const fromConfig = (config as any).mix;
        const raw =
          typeof fromInput === 'number' ? fromInput : Number(fromInput ?? fromConfig ?? 1);
        if (!Number.isFinite(raw)) return 1;
        return Math.max(0, Math.min(1, raw));
      })();

      const scale = (() => {
        const fromInput = inputs.scale;
        const fromConfig = (config as any).scale;
        const raw =
          typeof fromInput === 'number' ? fromInput : Number(fromInput ?? fromConfig ?? 0.5);
        if (!Number.isFinite(raw)) return 0.5;
        return Math.max(0.1, Math.min(1, raw));
      })();

      const bias = (() => {
        const fromInput = inputs.bias;
        const fromConfig = (config as any).bias;
        const raw =
          typeof fromInput === 'number' ? fromInput : Number(fromInput ?? fromConfig ?? 0);
        if (!Number.isFinite(raw)) return 0;
        return Math.max(-1, Math.min(1, raw));
      })();

      const normalize = (() => {
        const fromInput = inputs.normalize;
        if (typeof fromInput === 'number' && Number.isFinite(fromInput)) return fromInput >= 0.5;
        if (typeof fromInput === 'boolean') return fromInput;
        const fromConfig = (config as any).normalize;
        if (typeof fromConfig === 'number' && Number.isFinite(fromConfig)) return fromConfig >= 0.5;
        if (typeof fromConfig === 'boolean') return fromConfig;
        return true;
      })();

      const kernel = (() => {
        if (preset !== 'custom') return undefined;
        const fromInput = inputs.kernel;
        const fromConfig = (config as any).kernel;
        const raw =
          typeof fromInput === 'string' && fromInput.trim()
            ? fromInput.trim()
            : typeof fromConfig === 'string' && fromConfig.trim()
              ? fromConfig.trim()
              : '';
        if (!raw) return undefined;

        const parts = raw
          .split(/[\s,]+/g)
          .map((p) => p.trim())
          .filter(Boolean)
          .slice(0, 9);
        if (parts.length !== 9) return undefined;
        const parsed = parts.map((p) => Number(p));
        if (parsed.some((n) => !Number.isFinite(n))) return undefined;
        return parsed;
      })();

      return {
        cmd: {
          action: 'convolution',
          payload: {
            enabled,
            preset,
            ...(kernel ? { kernel } : {}),
            mix,
            scale,
            bias,
            normalize,
          },
        },
      };
    },
  };
}
