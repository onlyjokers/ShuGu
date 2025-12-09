export type ParameterType = 'number' | 'boolean' | 'enum' | 'trigger' | 'string';

export type ParameterSource = 'ui' | 'midi' | 'node' | 'script' | 'system' | string;

export interface ParameterMetadata {
  label?: string;
  description?: string;
  group?: string;
  section?: string;
  step?: number;
  unit?: string;
  widget?: 'slider' | 'toggle' | 'select' | 'button' | 'input';
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
  source?: ParameterSource;
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
}
