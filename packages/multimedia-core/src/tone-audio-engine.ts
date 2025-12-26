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
  private startPromise: Promise<{ enabled: boolean; error?: string }> | null = null;

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
   *
   * Important: Do NOT `await` anything before calling `Tone.start()` (user gesture will be lost).
   * This method guarantees that when Tone is already loaded, `Tone.start()` is invoked synchronously.
   */
  start(): Promise<{ enabled: boolean; error?: string }> {
    if (typeof window === 'undefined') return Promise.resolve({ enabled: false, error: 'not in a browser' });
    if (this.enabled) return Promise.resolve({ enabled: true });
    if (this.startPromise) return this.startPromise;

    const finalize = (tone: ToneModule) => {
      const state = tone.getContext().state;
      this.enabled = state === 'running';
      if (!this.enabled) this.lastError = `Tone context not running (state=${state})`;
      else this.lastError = null;
      return this.enabled ? { enabled: true } : { enabled: false, error: this.lastError ?? undefined };
    };

    const startLoadedTone = (tone: ToneModule) => {
      try {
        // Must be invoked synchronously from the user gesture stack.
        const started = tone.start();
        return Promise.resolve(started).then(() => finalize(tone));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.enabled = false;
        this.lastError = message;
        return { enabled: false, error: message };
      }
    };

    const run = (async () => {
      try {
        if (this.tone) return await startLoadedTone(this.tone);

        // Best-effort fallback: load then start. On mobile browsers this may still fail because the
        // start call happens after an async boundary; apps should call `ensureLoaded()` early.
        const tone = await this.ensureLoaded();
        return await startLoadedTone(tone);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.enabled = false;
        this.lastError = message;
        return { enabled: false, error: message };
      }
    })();

    this.startPromise = run.finally(() => {
      this.startPromise = null;
    });

    return this.startPromise;
  }
}

export const toneAudioEngine = new ToneAudioEngine();
