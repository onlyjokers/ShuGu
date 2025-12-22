/**
 * Purpose: MediaEngine — multimedia state machine for image/video playback.
 *
 * This is framework-agnostic (no DOM). The app layer (Svelte) renders state.
 * URLs can be raw or `asset:` refs; callers can inject a resolver.
 */

export type VideoState = {
  url: string | null;
  playing: boolean;
  muted: boolean;
  loop: boolean;
  volume: number;
};

export type ImageState = {
  url: string | null;
  visible: boolean;
  duration: number | undefined;
};

export type MediaEngineState = {
  video: VideoState;
  image: ImageState;
};

type Listener = (state: MediaEngineState) => void;

export class MediaEngine {
  private readonly listeners = new Set<Listener>();
  private state: MediaEngineState = {
    video: { url: null, playing: false, muted: true, loop: false, volume: 1 },
    image: { url: null, visible: false, duration: undefined },
  };

  constructor(private readonly opts: { resolveUrl?: (url: string) => string } = {}) {}

  subscribeState(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  getState(): MediaEngineState {
    return this.state;
  }

  private setState(next: Partial<MediaEngineState>): void {
    this.state = { ...this.state, ...next };
    for (const l of this.listeners) l(this.state);
  }

  private resolve(url: unknown): string | null {
    if (typeof url !== 'string' || !url.trim()) return null;
    const raw = url.trim();
    return this.opts.resolveUrl ? this.opts.resolveUrl(raw) : raw;
  }

  showImage(payload: { url: string; duration?: number }): void {
    const url = this.resolve(payload.url);
    this.setState({
      image: { url, visible: Boolean(url), duration: payload.duration },
    });
  }

  hideImage(): void {
    this.setState({ image: { url: null, visible: false, duration: undefined } });
  }

  playVideo(payload: { url: string; muted?: boolean; loop?: boolean; volume?: number }): void {
    const url = this.resolve(payload.url);
    this.setState({
      video: {
        url,
        playing: Boolean(url),
        muted: Boolean(payload.muted ?? true),
        loop: Boolean(payload.loop ?? false),
        volume: Math.max(0, Math.min(1, Number(payload.volume ?? 1) || 0)),
      },
    });
  }

  stopVideo(): void {
    this.setState({ video: { url: null, playing: false, muted: true, loop: false, volume: 1 } });
  }

  stopAllMedia(): void {
    this.stopVideo();
    this.hideImage();
  }
}

