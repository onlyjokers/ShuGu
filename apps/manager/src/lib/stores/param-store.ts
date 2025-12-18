/**
 * Svelte Store Adapter for Parameter objects.
 * Bridges OOP Parameter class to Svelte's reactive store system.
 */
import { readable, type Readable } from 'svelte/store';
import type { Parameter } from '../parameters/parameter';
import type { ParameterChange } from '../parameters/types';

export interface ParamStoreValue<T = unknown> {
  base: T;
  effective: T;
  isOffline: boolean;
  min?: number;
  max?: number;
  metadata?: Record<string, unknown>;
}

export interface ParamStore<T = unknown> extends Readable<ParamStoreValue<T>> {
  /** Set the base value (from UI) */
  set: (value: T) => void;
  /** Get the underlying Parameter object */
  getParameter: () => Parameter<T>;
}

/**
 * Creates a Svelte store that wraps a Parameter object.
 * Automatically handles listener lifecycle (no memory leaks).
 */
export function createParamStore<T>(parameter: Parameter<T>): ParamStore<T> {
  // Create readable store with custom start/stop logic
  const { subscribe } = readable<ParamStoreValue<T>>(
    {
      base: parameter.baseValue,
      effective: parameter.effectiveValue,
      isOffline: parameter.isOffline,
      min: parameter.min,
      max: parameter.max,
      metadata: parameter.metadata as Record<string, unknown>,
    },
    (set) => {
      // This function runs when first subscriber connects
      const updateStore = () => {
        set({
          base: parameter.baseValue,
          effective: parameter.effectiveValue,
          isOffline: parameter.isOffline,
          min: parameter.min,
          max: parameter.max,
          metadata: parameter.metadata as Record<string, unknown>,
        });
      };

      // Subscribe to parameter changes
      const unsubscribe = parameter.addListener((_val: T, _change: ParameterChange<T>) => {
        updateStore();
      });

      // Return cleanup function (runs when last subscriber disconnects)
      return () => {
        unsubscribe();
      };
    }
  );

  return {
    subscribe,
    set: (value: T) => {
      parameter.setValue(value, 'UI');
    },
    getParameter: () => parameter,
  };
}

/**
 * Utility to create stores for all parameters under a prefix.
 */
import { parameterRegistry } from '../parameters/registry';

export function createParamStoresForClient(clientId: string): Map<string, ParamStore<unknown>> {
  const stores = new Map<string, ParamStore<unknown>>();
  const params = parameterRegistry.list(`client/${clientId}`);
  
  for (const param of params) {
    stores.set(param.path, createParamStore(param));
  }
  
  return stores;
}
