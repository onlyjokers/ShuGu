/**
 * Purpose: Scene chain nodes and legacy scene processors.
 */
import type { VisualSceneLayerItem } from '@shugu/protocol';

import type { NodeDefinition } from '../../types.js';

export function createBoxSceneProcessorNode(): NodeDefinition {
  return {
    type: 'proc-visual-scene-box',
    label: 'Legacy Visual Scene-Box',
    category: 'Legacy',
    inputs: [{ id: 'enabled', label: 'Enabled', type: 'boolean', defaultValue: true }],
    outputs: [{ id: 'cmd', label: 'Cmd', type: 'command' }],
    configSchema: [{ key: 'enabled', label: 'Enabled', type: 'boolean', defaultValue: true }],
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

      return {
        cmd: { action: 'visualSceneBox', payload: { enabled } },
      };
    },
  };
}

export function createMelSceneProcessorNode(): NodeDefinition {
  return {
    type: 'proc-visual-scene-mel',
    label: 'Legacy Visual Scene-Mel Spectrogram',
    category: 'Legacy',
    inputs: [{ id: 'enabled', label: 'Enabled', type: 'boolean', defaultValue: false }],
    outputs: [{ id: 'cmd', label: 'Cmd', type: 'command' }],
    configSchema: [{ key: 'enabled', label: 'Enabled', type: 'boolean', defaultValue: false }],
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

      return {
        cmd: { action: 'visualSceneMel', payload: { enabled } },
      };
    },
  };
}

export function createFrontCameraSceneProcessorNode(): NodeDefinition {
  return {
    type: 'proc-visual-scene-front-camera',
    label: 'Legacy Visual Scene-Front Camera',
    category: 'Legacy',
    inputs: [{ id: 'enabled', label: 'Enabled', type: 'boolean', defaultValue: false }],
    outputs: [{ id: 'cmd', label: 'Cmd', type: 'command' }],
    configSchema: [{ key: 'enabled', label: 'Enabled', type: 'boolean', defaultValue: false }],
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

      return {
        cmd: { action: 'visualSceneFrontCamera', payload: { enabled } },
      };
    },
  };
}

export function createBackCameraSceneProcessorNode(): NodeDefinition {
  return {
    type: 'proc-visual-scene-back-camera',
    label: 'Legacy Visual Scene-Back Camera',
    category: 'Legacy',
    inputs: [{ id: 'enabled', label: 'Enabled', type: 'boolean', defaultValue: false }],
    outputs: [{ id: 'cmd', label: 'Cmd', type: 'command' }],
    configSchema: [{ key: 'enabled', label: 'Enabled', type: 'boolean', defaultValue: false }],
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

      return {
        cmd: { action: 'visualSceneBackCamera', payload: { enabled } },
      };
    },
  };
}

export function createSceneBoxNode(): NodeDefinition {
  const coerceSceneChain = (raw: unknown): VisualSceneLayerItem[] =>
    (Array.isArray(raw) ? raw : []).filter(
      (v): v is VisualSceneLayerItem =>
        Boolean(v) && typeof v === 'object' && typeof (v as any).type === 'string'
    );

  return {
    type: 'scene-box',
    label: 'Scene Box',
    category: 'Scene',
    inputs: [{ id: 'in', label: 'In', type: 'scene' }],
    outputs: [{ id: 'out', label: 'Out', type: 'scene' }],
    configSchema: [],
    process: (inputs) => {
      const chain = coerceSceneChain(inputs.in);
      const scene: VisualSceneLayerItem = { type: 'box' };
      return { out: [...chain, scene] };
    },
  };
}

export function createSceneMelNode(): NodeDefinition {
  const coerceSceneChain = (raw: unknown): VisualSceneLayerItem[] =>
    (Array.isArray(raw) ? raw : []).filter(
      (v): v is VisualSceneLayerItem =>
        Boolean(v) && typeof v === 'object' && typeof (v as any).type === 'string'
    );

  return {
    type: 'scene-mel',
    label: 'Scene Mel Spectrogram',
    category: 'Scene',
    inputs: [{ id: 'in', label: 'In', type: 'scene' }],
    outputs: [{ id: 'out', label: 'Out', type: 'scene' }],
    configSchema: [],
    process: (inputs) => {
      const chain = coerceSceneChain(inputs.in);
      const scene: VisualSceneLayerItem = { type: 'mel' };
      return { out: [...chain, scene] };
    },
  };
}

export function createSceneFrontCameraNode(): NodeDefinition {
  const coerceSceneChain = (raw: unknown): VisualSceneLayerItem[] =>
    (Array.isArray(raw) ? raw : []).filter(
      (v): v is VisualSceneLayerItem =>
        Boolean(v) && typeof v === 'object' && typeof (v as any).type === 'string'
    );

  return {
    type: 'scene-front-camera',
    label: 'Scene Front Camera',
    category: 'Scene',
    inputs: [{ id: 'in', label: 'In', type: 'scene' }],
    outputs: [{ id: 'out', label: 'Out', type: 'scene' }],
    configSchema: [],
    process: (inputs) => {
      const chain = coerceSceneChain(inputs.in);
      const scene: VisualSceneLayerItem = { type: 'frontCamera' };
      return { out: [...chain, scene] };
    },
  };
}

export function createSceneBackCameraNode(): NodeDefinition {
  const coerceSceneChain = (raw: unknown): VisualSceneLayerItem[] =>
    (Array.isArray(raw) ? raw : []).filter(
      (v): v is VisualSceneLayerItem =>
        Boolean(v) && typeof v === 'object' && typeof (v as any).type === 'string'
    );

  return {
    type: 'scene-back-camera',
    label: 'Scene Back Camera',
    category: 'Scene',
    inputs: [{ id: 'in', label: 'In', type: 'scene' }],
    outputs: [{ id: 'out', label: 'Out', type: 'scene' }],
    configSchema: [],
    process: (inputs) => {
      const chain = coerceSceneChain(inputs.in);
      const scene: VisualSceneLayerItem = { type: 'backCamera' };
      return { out: [...chain, scene] };
    },
  };
}
