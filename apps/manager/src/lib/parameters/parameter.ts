import type {
  ParameterChange,
  ParameterMetadata,
  ParameterOptions,
  ParameterSnapshot,
  ParameterSource,
  ParameterType,
} from './types';

type Listener<T> = (value: T, change: ParameterChange<T>) => void;

function clampNumber(value: number, min?: number, max?: number): number {
  let next = value;
  if (typeof min === 'number') next = Math.max(min, next);
  if (typeof max === 'number') next = Math.min(max, next);
  return next;
}

function numbersEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9;
}

function shallowEqual<T>(a: T, b: T): boolean {
  if (typeof a === 'number' && typeof b === 'number') return numbersEqual(a, b);
  return a === b;
}

function normalizePath(path: string): string {
  return path
    .replace(/\/+/g, '/')
    .replace(/^\//, '')
    .replace(/\/$/, '');
}

export { normalizePath };

export class Parameter<T = number> {
  readonly path: string;
  readonly type: ParameterType;
  readonly metadata?: ParameterMetadata;
  readonly enumOptions?: ParameterOptions<T>['enumOptions'];

  private _defaultValue: T;
  private _baseValue: T;
  private _min?: number;
  private _max?: number;
  private modulators: Map<string, number> = new Map();
  private listeners: Set<Listener<T>> = new Set();
  
  // Robustness state
  private _isOffline = false;

  constructor(options: ParameterOptions<T>) {
    this.path = normalizePath(options.path);
    this.type = options.type;
    this.metadata = options.metadata;
    this.enumOptions = options.enumOptions;
    this._defaultValue = options.defaultValue;
    this._baseValue = options.defaultValue;
    this._min = options.min;
    this._max = options.max;
  }

  get baseValue(): T {
    return this._baseValue;
  }

  get defaultValue(): T {
    return this._defaultValue;
  }

  get modulationOffset(): number {
    let sum = 0;
    this.modulators.forEach((value) => {
      sum += value;
    });
    return sum;
  }

  get min(): number | undefined {
    return this._min;
  }

  get max(): number | undefined {
    return this._max;
  }
  
  get isOffline(): boolean {
    return this._isOffline;
  }

  get effectiveValue(): T {
    if (this.type === 'number') {
      const base = Number(this._baseValue);
      const next = clampNumber(base + this.modulationOffset, this._min, this._max);
      return next as unknown as T;
    }
    return this._baseValue;
  }

  setOffline(offline: boolean): void {
    this._isOffline = offline;
    // We might want to emit an event here, but usually UI just redraws
  }

  /**
   * Set the base value.
   * STRICT REQUIREMENT: source must be provided.
   */
  setValue(val: T, source: ParameterSource): boolean {
    return this.setBaseValue(val, source);
  }

  setBaseValue(val: T, source: ParameterSource): boolean {
    const oldEffective = this.effectiveValue;
    let nextBase: T = val;

    if (this.type === 'number') {
      nextBase = clampNumber(Number(val), this._min, this._max) as unknown as T;
    }
    if (this.type === 'boolean') {
      nextBase = Boolean(val) as unknown as T;
    }

    if (shallowEqual(this._baseValue, nextBase)) {
      return false;
    }

    this._baseValue = nextBase;
    const newEffective = this.effectiveValue;
    this.emit({
      newValue: newEffective,
      oldValue: oldEffective,
      source,
      kind: 'base',
    });
    return true;
  }

  /**
   * Apply or update modulation contribution from a source (MIDI / node / automation)
   */
  setModulation(sourceId: string, offset: number, source: ParameterSource = 'MIDI'): boolean {
    if (this.type !== 'number') return false;
    const oldEffective = this.effectiveValue as unknown as number;
    if (numbersEqual(this.modulators.get(sourceId) ?? 0, offset)) {
      return false;
    }
    this.modulators.set(sourceId, offset);
    const newEffective = this.effectiveValue;
    this.emit({
      newValue: newEffective,
      oldValue: oldEffective as unknown as T,
      source,
      kind: 'modulation',
    });
    return true;
  }

  clearModulation(sourceId?: string, source: ParameterSource = 'MIDI'): boolean {
    if (this.type !== 'number') return false;
    const oldEffective = this.effectiveValue as unknown as number;
    let changed = false;
    if (sourceId) {
      changed = this.modulators.delete(sourceId);
    } else if (this.modulators.size > 0) {
      this.modulators.clear();
      changed = true;
    }
    if (!changed) return false;
    const newEffective = this.effectiveValue;
    this.emit({
      newValue: newEffective as unknown as T,
      oldValue: oldEffective as unknown as T,
      source,
      kind: 'modulation',
    });
    return true;
  }

  reset(source: ParameterSource = 'SYSTEM'): void {
    this.modulators.clear();
    this._baseValue = this._defaultValue;
    this.emit({
      newValue: this.effectiveValue,
      oldValue: this._defaultValue,
      source,
      kind: 'base',
    });
  }

  snapshot(): ParameterSnapshot<T> {
    return {
      path: this.path,
      type: this.type,
      value: this.effectiveValue,
      baseValue: this._baseValue,
      effectiveValue: this.effectiveValue,
      min: this._min,
      max: this._max,
      metadata: this.metadata,
      enumOptions: this.enumOptions,
      isOffline: this._isOffline,
      modulators: Object.fromEntries(this.modulators.entries()),
    };
  }

  addListener(listener: Listener<T>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(change: ParameterChange<T>): void {
    this.listeners.forEach((listener) => {
      try {
        listener(this.effectiveValue, change);
      } catch (err) {
        console.error('[Parameter] listener error for', this.path, err);
      }
    });
  }
}
