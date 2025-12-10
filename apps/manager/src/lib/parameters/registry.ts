import { Parameter, normalizePath } from './parameter';
import type { ParameterOptions, ParameterSnapshot } from './types';

/**
 * Singleton registry that holds every parameter as a "single source of truth".
 */
export class ParameterRegistry {
  private static _instance: ParameterRegistry;
  private parameters = new Map<string, Parameter<unknown>>();

  static get instance(): ParameterRegistry {
    if (!this._instance) {
      this._instance = new ParameterRegistry();
    }
    return this._instance;
  }

  register<T>(options: ParameterOptions<T>): Parameter<T> {
    const path = normalizePath(options.path);
    const existing = this.parameters.get(path);
    // Reuse existing parameter to preserve references (crucial for Node Graph/Listeners)
    if (existing) {
        // If it was offline, bring it back
        existing.setOffline(false);
        return existing as unknown as Parameter<T>;
    }

    const param = new Parameter<T>({ ...options, path });
    this.parameters.set(path, param);
    return param;
  }

  get<T>(path: string): Parameter<T> | undefined {
    return this.parameters.get(normalizePath(path)) as Parameter<T> | undefined;
  }

  has(path: string): boolean {
    return this.parameters.has(normalizePath(path));
  }

  /**
   * Mark parameters under a prefix as offline (Soft Delete).
   * Do NOT remove them from the map.
   */
  markOffline(prefix: string): void {
     this.list(prefix).forEach(p => p.setOffline(true));
  }
  
  /**
   * Mark parameters under a prefix as online.
   */
  markOnline(prefix: string): void {
    this.list(prefix).forEach(p => p.setOffline(false));
  }

  /**
   * Hard delete - only use if you really mean it (e.g. app reset)
   */
  remove(path: string): boolean {
    return this.parameters.delete(normalizePath(path));
  }

  /**
   * List parameters under a prefix (e.g., "client/1")
   */
  list(prefix?: string): Parameter<unknown>[] {
    if (!prefix) return Array.from(this.parameters.values());
    const normalized = normalizePath(prefix);
    const withSlash = normalized.endsWith('/') ? normalized : `${normalized}/`;
    return Array.from(this.parameters.entries())
      .filter(([key]) => key === normalized || key.startsWith(withSlash))
      .map(([, param]) => param);
  }

  /**
   * Convenience snapshot for UI/debugging
   */
  snapshot(prefix?: string): ParameterSnapshot[] {
    return this.list(prefix).map((p) => p.snapshot());
  }

  clear(): void {
    this.parameters.clear();
  }
}

export const parameterRegistry = ParameterRegistry.instance;
