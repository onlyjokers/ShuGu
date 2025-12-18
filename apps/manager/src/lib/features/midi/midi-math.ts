/**
 * MIDI Math Utilities
 * Pure functions for MIDI value normalization and range mapping.
 */

/**
 * Normalize MIDI value (0-127) to 0.0-1.0
 */
export function normalizeMidi(raw: number): number {
  return Math.max(0, Math.min(1, raw / 127));
}

/**
 * Denormalize 0.0-1.0 back to MIDI value (0-127)
 */
export function denormalizeMidi(normalized: number): number {
  return Math.round(Math.max(0, Math.min(1, normalized)) * 127);
}

/**
 * Map a normalized value (0.0-1.0) to a target range
 */
export function mapRange(value01: number, targetMin: number, targetMax: number): number {
  const clamped = Math.max(0, Math.min(1, value01));
  return targetMin + clamped * (targetMax - targetMin);
}

/**
 * Map a normalized value with optional inversion
 */
export function mapRangeWithOptions(
  value01: number, 
  targetMin: number, 
  targetMax: number, 
  invert: boolean = false
): number {
  const effective = invert ? 1 - value01 : value01;
  return mapRange(effective, targetMin, targetMax);
}

/**
 * Clamp a value within bounds
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Linear interpolation
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}
