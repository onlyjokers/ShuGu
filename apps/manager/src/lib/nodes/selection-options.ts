/**
 * Selection option helpers (Manager)
 *
 * Provides a light-weight way to infer enum option lists for inputs whose
 * config schema is declared as a select field (e.g. waveform / mode).
 */
import { nodeRegistry } from './registry';

export function getSelectOptionsForInput(nodeType: string, inputId: string): string[] | null {
  const def = nodeRegistry.get(nodeType);
  const field = def?.configSchema?.find((item) => item.key === inputId && item.type === 'select');
  if (!field?.options || field.options.length === 0) return null;
  return field.options
    .map((opt) => (opt?.value !== undefined ? String(opt.value) : ''))
    .filter((value) => value !== '');
}
