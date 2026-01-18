/**
 * Purpose: Capability mapping for node types.
 */

export const capabilityForNodeType = (type: string | undefined): string | null => {
  if (!type) return null;
  if (type === 'proc-client-sensors') return 'sensors';
  if (type === 'proc-flashlight') return 'flashlight';
  if (type === 'proc-screen-color') return 'screen';
  if (type === 'proc-synth-update') return 'sound';
  if (type === 'tone-osc') return 'sound';
  if (type === 'audio-data') return 'sound';
  if (type === 'tone-delay') return 'sound';
  if (type === 'tone-resonator') return 'sound';
  if (type === 'tone-pitch') return 'sound';
  if (type === 'tone-reverb') return 'sound';
  if (type === 'tone-granular') return 'sound';
  if (type === 'tone-lfo') return 'sound';
  if (type === 'play-media') return 'sound';
  if (type === 'proc-scene-switch') return 'visual';
  if (type === 'audio-out') return 'sound';
  if (type === 'load-audio-from-assets') return 'sound';
  if (type === 'load-audio-from-local') return 'sound';
  if (type === 'load-image-from-assets') return 'visual';
  if (type === 'load-image-from-local') return 'visual';
  if (type === 'load-video-from-assets') return 'visual';
  if (type === 'load-video-from-local') return 'visual';
  if (type === 'image-out') return 'visual';
  if (type === 'video-out') return 'visual';
  if (type === 'effect-out') return 'visual';
  if (type === 'scene-out') return 'visual';
  return null;
};
