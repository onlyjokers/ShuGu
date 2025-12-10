import { parameterRegistry } from './registry';
import type { Parameter } from './parameter';

type ParameterMap = Record<string, Parameter<any>>;

/**
 * Register a minimal set of control-surface parameters so the UI factory can render them.
 * This is intentionally small to keep incremental migration safe.
 */
export function registerDefaultControlParameters(): ParameterMap {
  const params: ParameterMap = {};

  params['controls/synth/frequency'] = parameterRegistry.register<number>({
    path: 'controls/synth/frequency',
    type: 'number',
    defaultValue: 180,
    min: 20,
    max: 2000,
    metadata: { label: 'Freq (Hz)', group: 'Synth', step: 10, widgetType: 'slider' },
  });

  params['controls/synth/duration'] = parameterRegistry.register<number>({
    path: 'controls/synth/duration',
    type: 'number',
    defaultValue: 200,
    min: 20,
    max: 4000,
    metadata: { label: 'Dur (ms)', group: 'Synth', step: 10, widgetType: 'slider' },
  });

  params['controls/synth/volume'] = parameterRegistry.register<number>({
    path: 'controls/synth/volume',
    type: 'number',
    defaultValue: 0.7,
    min: 0,
    max: 1,
    metadata: { label: 'Volume', group: 'Synth', step: 0.05, widgetType: 'slider' },
  });

  params['controls/synth/modDepth'] = parameterRegistry.register<number>({
    path: 'controls/synth/modDepth',
    type: 'number',
    defaultValue: 0,
    min: 0,
    max: 1,
    metadata: { label: 'Wobble Depth', group: 'Synth', step: 0.05, widgetType: 'slider' },
  });

  params['controls/synth/modLfo'] = parameterRegistry.register<number>({
    path: 'controls/synth/modLfo',
    type: 'number',
    defaultValue: 12,
    min: 1,
    max: 40,
    metadata: { label: 'Wobble Rate (Hz)', group: 'Synth', step: 1, widgetType: 'input' },
  });

  params['controls/synth/waveform'] = parameterRegistry.register<string>({
    path: 'controls/synth/waveform',
    type: 'enum',
    defaultValue: 'square',
    enumOptions: [
      { value: 'square', label: 'Square' },
      { value: 'sine', label: 'Sine' },
      { value: 'triangle', label: 'Triangle' },
      { value: 'sawtooth', label: 'Sawtooth' },
    ],
    metadata: { label: 'Waveform', group: 'Synth', widgetType: 'select' },
  });

  params['controls/synth/wobbleEnabled'] = parameterRegistry.register<boolean>({
    path: 'controls/synth/wobbleEnabled',
    type: 'boolean',
    defaultValue: false,
    metadata: { label: 'Enable Wobble', group: 'Synth', widgetType: 'toggle' },
  });

  return params;
}
