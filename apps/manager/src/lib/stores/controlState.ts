import { writable } from 'svelte/store';

export type ControlSharedState = {
  flashlightOn: boolean;
  asciiOn: boolean;
  modFrequency: number;
  modDuration: number;
  modVolume: number;
  modDepth: number;
  modLfo: number;
  modWaveform: 'sine' | 'square' | 'sawtooth' | 'triangle';
  asciiResolution: number;
  screenOpacity: number;
  soundVolume: number;
  selectedScene: string;
};

const initialState: ControlSharedState = {
  flashlightOn: false,
  asciiOn: true,
  modFrequency: 180,
  modDuration: 200,
  modVolume: 0.7,
  modDepth: 0,
  modLfo: 12,
  modWaveform: 'square',
  asciiResolution: 11,
  screenOpacity: 1,
  soundVolume: 1,
  selectedScene: 'box-scene',
};

export const controlState = writable<ControlSharedState>(initialState);

export function updateControlState(patch: Partial<ControlSharedState>): void {
  controlState.update((state) => ({ ...state, ...patch }));
}
