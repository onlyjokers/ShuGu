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
  startSec: number;
  endSec: number;
  cursorSec: number;
  reverse: boolean;
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
    video: {
      url: null,
      playing: false,
      muted: true,
      loop: false,
      volume: 1,
      startSec: 0,
      endSec: -1,
      cursorSec: -1,
      reverse: false,
    },
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

  playVideo(payload: {
    url: string;
    muted?: boolean;
    loop?: boolean;
    volume?: number;
    playing?: boolean;
    startSec?: number;
    endSec?: number;
    cursorSec?: number;
    reverse?: boolean;
  }): void {
    const url = this.resolve(payload.url);
    const startSecRaw = payload.startSec ?? 0;
    const endSecRaw = payload.endSec ?? -1;
    const cursorSecRaw = payload.cursorSec ?? -1;
    const playingRaw = payload.playing;
    const reverseRaw = payload.reverse;

    const startSec = typeof startSecRaw === 'number' && Number.isFinite(startSecRaw) ? Math.max(0, startSecRaw) : 0;
    const endCandidate = typeof endSecRaw === 'number' && Number.isFinite(endSecRaw) ? endSecRaw : -1;
    const endSec = endCandidate >= 0 ? Math.max(startSec, endCandidate) : -1;
    const cursorCandidate =
      typeof cursorSecRaw === 'number' && Number.isFinite(cursorSecRaw) ? cursorSecRaw : -1;
    const cursorSec = cursorCandidate >= 0 ? Math.max(startSec, cursorCandidate) : -1;
    const reverse = Boolean(reverseRaw ?? false);
    const playing =
      typeof playingRaw === 'boolean' ? playingRaw : typeof playingRaw === 'number' ? playingRaw >= 0.5 : Boolean(url);

    this.setState({
      video: {
        url,
        playing,
        muted: Boolean(payload.muted ?? true),
        loop: Boolean(payload.loop ?? false),
        volume: Math.max(0, Math.min(1, Number(payload.volume ?? 1) || 0)),
        startSec,
        endSec,
        cursorSec,
        reverse,
      },
    });
  }

  stopVideo(): void {
    this.setState({
      video: {
        url: null,
        playing: false,
        muted: true,
        loop: false,
        volume: 1,
        startSec: 0,
        endSec: -1,
        cursorSec: -1,
        reverse: false,
      },
    });
  }

  stopAllMedia(): void {
    this.stopVideo();
    this.hideImage();
  }
}
