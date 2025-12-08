import { writable } from 'svelte/store';

export type ControlSharedState = {
  flashlightOn: boolean;
  asciiOn: boolean;
  modFrequency: number;
  asciiResolution: number;
  screenOpacity: number;
  selectedScene: string;
};

const initialState: ControlSharedState = {
  flashlightOn: false,
  asciiOn: true,
  modFrequency: 180,
  asciiResolution: 11,
  screenOpacity: 1,
  selectedScene: 'box-scene',
};

export const controlState = writable<ControlSharedState>(initialState);

export function updateControlState(patch: Partial<ControlSharedState>): void {
  controlState.update((state) => ({ ...state, ...patch }));
}
