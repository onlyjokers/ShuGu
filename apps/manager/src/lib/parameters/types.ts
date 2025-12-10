export type ParameterType = 'number' | 'boolean' | 'enum' | 'trigger' | 'string' | 'color';

export type ParameterSource = 'UI' | 'MIDI' | 'DEVICE' | 'SYSTEM' | 'NODE' | string;

export interface ParameterMetadata {
  label?: string;
  description?: string;
  group?: string;
  section?: string;
  step?: number;
  unit?: string;
  widgetType?: 'slider' | 'knob' | 'toggle' | 'select' | 'button' | 'input' | 'color'; // Renamed from widget
  hidden?: boolean;
}

export interface EnumOption {
  value: string;
  label?: string;
}

export interface ParameterOptions<T> {
  path: string;
  type: ParameterType;
  defaultValue: T;
  min?: number;
  max?: number;
  metadata?: ParameterMetadata;
  enumOptions?: EnumOption[];
}

export interface ParameterChange<T> {
  newValue: T;
  oldValue: T;
  source: ParameterSource; // Made required
  kind: 'base' | 'modulation' | 'effective';
}

export interface ParameterSnapshot<T = unknown> {
  path: string;
  type: ParameterType;
  value: T;
  baseValue: T;
  effectiveValue: T;
  min?: number;
  max?: number;
  metadata?: ParameterMetadata;
  enumOptions?: EnumOption[];
  isOffline?: boolean;
}
