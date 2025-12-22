/**
 * Purpose: Single Tone.js audio context entrypoint for the client runtime.
 *
 * Goals:
 * - Ensure we only call `Tone.start()` from a user gesture (Start button).
 * - Provide a shared place to track loaded/enabled/error status.
 * - Avoid multiple Tone imports and duplicated AudioContext state.
 */

type ToneModule = typeof import('tone');

export type ToneAudioEngineStatus = {
  loaded: boolean;
  enabled: boolean;
  error: string | null;
};

export class ToneAudioEngine {
  private tone: ToneModule | null = null;
  private loadPromise: Promise<ToneModule> | null = null;
  private enabled = false;
  private lastError: string | null = null;

  getStatus(): ToneAudioEngineStatus {
    return { loaded: Boolean(this.tone), enabled: this.enabled, error: this.lastError };
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getToneModule(): ToneModule | null {
    return this.tone;
  }

  async ensureLoaded(): Promise<ToneModule> {
    if (this.tone) return this.tone;
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = import('tone')
      .then((mod) => {
        this.tone = mod as unknown as ToneModule;
        return this.tone;
      })
      .finally(() => {
        this.loadPromise = null;
      });
    return this.loadPromise;
  }

  /**
   * Enable audio. Must be called from a user gesture for mobile browsers.
   */
  async start(): Promise<{ enabled: boolean; error?: string }> {
    if (typeof window === 'undefined') return { enabled: false, error: 'not in a browser' };
    try {
      const tone = await this.ensureLoaded();
      await tone.start();
      const state = tone.getContext().state;
      this.enabled = state === 'running';
      if (!this.enabled) this.lastError = `Tone context not running (state=${state})`;
      else this.lastError = null;
      return this.enabled ? { enabled: true } : { enabled: false, error: this.lastError ?? undefined };
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      this.enabled = false;
      return { enabled: false, error: this.lastError };
    }
  }
}

export const toneAudioEngine = new ToneAudioEngine();

