import { readable, writable, type Readable, type Writable } from 'svelte/store';
import type { Parameter } from './parameter';
import type { ParameterSource } from './types';

/**
 * One-way Svelte readable store that mirrors a Parameter's effective value.
 */
export function parameterReadable<T>(param: Parameter<T>): Readable<T> {
  return readable(param.effectiveValue, (set) => {
    const stop = param.addListener((value) => set(value));
    set(param.effectiveValue);
    return stop;
  });
}

/**
 * Two-way Svelte writable store. Updates from UI propagate into the Parameter,
 * and Parameter changes propagate back without causing loops.
 */
export function parameterWritable<T>(
  param: Parameter<T>,
  source: ParameterSource = 'ui'
): Writable<T> {
  const base = writable<T>(param.effectiveValue);
  let fromParam = false;

  const stopParam = param.addListener((value) => {
    fromParam = true;
    base.set(value);
    fromParam = false;
  });

  const { subscribe, set } = base;

  return {
    subscribe,
    set: (value: T) => {
      if (fromParam) return;
      param.setValue(value, source);
    },
    update: (updater) => {
      const next = updater(param.effectiveValue);
      param.setValue(next, source);
    },
  };
}
