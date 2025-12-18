import { writable } from 'svelte/store';

export type MinimapPreferences = {
  /** Minimap top-left x in px relative to the NodeCanvas container. */
  x: number;
  /** Minimap top-left y in px relative to the NodeCanvas container. */
  y: number;
  /** Square minimap size in px (excluding the left bar). */
  size: number;
};

export const minimapPreferences = writable<MinimapPreferences>({
  x: -1,
  y: -1,
  size: 190,
});
