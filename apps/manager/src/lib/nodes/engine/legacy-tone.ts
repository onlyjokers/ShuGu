/**
 * Purpose: Sanitize legacy Tone node config fields.
 */

const LEGACY_TONE_FIELDS_BY_TYPE = new Map<string, string[]>([
  ['tone-delay', ['bus', 'order', 'enabled']],
  ['tone-resonator', ['bus', 'order', 'enabled']],
  ['tone-pitch', ['bus', 'order', 'enabled']],
  ['tone-reverb', ['bus', 'order', 'enabled']],
  ['tone-osc', ['bus', 'enabled']],
  ['tone-granular', ['bus', 'enabled']],
  ['tone-lfo', ['enabled']],
  ['load-audio-from-assets', ['bus']],
  ['load-audio-from-local', ['bus']],
]);

export const stripLegacyToneFields = (
  type: string,
  config: Record<string, unknown>,
  inputValues: Record<string, unknown>
): void => {
  const keys = LEGACY_TONE_FIELDS_BY_TYPE.get(String(type ?? ''));
  if (!keys || keys.length === 0) return;
  for (const key of keys) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    if (Object.prototype.hasOwnProperty.call(config, key)) delete config[key];
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    if (Object.prototype.hasOwnProperty.call(inputValues, key)) delete inputValues[key];
  }
};
