import { readable, type Readable } from 'svelte/store';
import type { Parameter } from '../parameters/parameter';

export interface ParamStoreValue<T> {
  value: T;          // Current effective value (alias)
  base: T;           // Base value (User controlled)
  effective: T;      // Effective value (Base + Modulation)
  isOffline: boolean;
}

export interface ParamStore<T> extends Readable<ParamStoreValue<T>> {
  set(value: T): void;
}

/**
 * Creates a Svelte Store from a Parameter.
 * Automatically manages listeners (subscribe/unsubscribe).
 */
export function createParamStore<T>(param: Parameter<T>): ParamStore<T> {
  const { subscribe } = readable<ParamStoreValue<T>>(
    // Initial value
    {
      value: param.effectiveValue,
      base: param.baseValue,
      effective: param.effectiveValue,
      isOffline: param.isOffline,
    },
    // Start function (called when first subscriber joins)
    (set) => {
      // Listener for parameter changes
      const removeListener = param.addListener((val, change) => {
        set({
          value: param.effectiveValue,
          base: param.baseValue,
          effective: param.effectiveValue,
          isOffline: param.isOffline,
        });
      });

      // Since 'isOffline' might not trigger value change but is important,
      // in a real app we'd have an event for that too. 
      // For now, we assume parameter updates emit for offline state changes if implemented,
      // or we trust that value updates cover most cases. 
      // TODO: Add 'status' event to Parameter class if needed specifically for offline/online toggles without value change.

      // Stop function (called when last subscriber leaves)
      return () => {
        removeListener();
      };
    }
  );

  return {
    subscribe,
    /**
     * Set the Base Value (User Action)
     */
    set: (value: T) => {
      param.setValue(value, 'UI');
    },
  };
}
