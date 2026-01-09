/**
 * Purpose: Tone.js-backed audio runtime for node graph (oscillator + effects + granular).
 *
 * This is a thin entrypoint; the implementation is split under `src/tone-adapter/*`.
 */

export { enableToneAudio, isToneAudioEnabled, getToneAudioStatus } from './tone-adapter/engine-host.js';
export { registerToneClientDefinitions } from './tone-adapter/register.js';
export type { ToneAdapterDeps, ToneAdapterHandle } from './tone-adapter/types.js';

