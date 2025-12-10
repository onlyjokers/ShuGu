/**
 * Svelte integration utilities for Parameter system.
 * Re-exports from the stores module for convenient access.
 */
import { writable, type Writable } from 'svelte/store';
import type { Parameter } from './parameter';
import type { ParameterChange } from './types';

/**
 * Creates a simple writable store that syncs with a Parameter.
 * This is a simpler version that just exposes the effective value.
 * For full base/effective/offline state, use createParamStore from stores/param-store.ts
 */
export function parameterWritable<T>(parameter: Parameter<T>): Writable<T> {
  const store = writable<T>(parameter.effectiveValue);

  // Subscribe to parameter changes
  let unsubscribe: (() => void) | null = null;
  
  const originalSubscribe = store.subscribe;
  let subscriberCount = 0;
  
  // Override subscribe to manage listener lifecycle
  store.subscribe = (run, invalidate?) => {
    subscriberCount++;
    
    if (subscriberCount === 1 && !unsubscribe) {
      unsubscribe = parameter.addListener((val: T, _change: ParameterChange<T>) => {
        store.set(val);
      });
    }
    
    const unsub = originalSubscribe(run, invalidate);
    
    return () => {
      unsub();
      subscriberCount--;
      if (subscriberCount === 0 && unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    };
  };

  // Override set to update parameter
  const originalSet = store.set;
  store.set = (value: T) => {
    parameter.setValue(value, 'UI');
    originalSet(value);
  };

  // Override update to use parameter
  store.update = (fn: (value: T) => T) => {
    const newValue = fn(parameter.effectiveValue);
    parameter.setValue(newValue, 'UI');
    originalSet(newValue);
  };

  return store;
}

// Re-export for convenience
export { createParamStore, type ParamStore, type ParamStoreValue } from '../stores/param-store';
