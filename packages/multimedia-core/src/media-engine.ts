/**
 * Purpose: MediaEngine — multimedia state machine for image/video playback.
 *
 * This is framework-agnostic (no DOM). The app layer (Svelte) renders state.
 * URLs can be raw or `asset:` refs; callers can inject a resolver.
 */

export type MediaFit = 'contain' | 'fit-screen' | 'cover' | 'fill';

export type VideoState = {
  url: string | null;
  // Optional node graph source id (e.g. load-video-from-assets nodeId) for UI telemetry.
  sourceNodeId: string | null;
  playing: boolean;
  muted: boolean;
  loop: boolean;
  volume: number;
  startSec: number;
  endSec: number;
  cursorSec: number;
  reverse: boolean;
  fit: MediaFit;
};

export type ImageState = {
  url: string | null;
  visible: boolean;
  duration: number | undefined;
  fit: MediaFit;
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
      sourceNodeId: null,
      playing: false,
      muted: true,
      loop: false,
      volume: 1,
      startSec: 0,
      endSec: -1,
      cursorSec: -1,
      reverse: false,
      fit: 'contain',
    },
    image: { url: null, visible: false, duration: undefined, fit: 'contain' },
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

  private coerceFit(raw: unknown): MediaFit {
    const normalized = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (normalized === 'fit-screen' || normalized === 'fitscreen' || normalized === 'fullscreen')
      return 'fit-screen';
    if (normalized === 'cover') return 'cover';
    if (normalized === 'fill' || normalized === 'stretch') return 'fill';
    return 'contain';
  }

  showImage(payload: { url: string; duration?: number; fit?: MediaFit }): void {
    const url = this.resolve(payload.url);
    const fit = this.coerceFit(payload.fit);
    this.setState({
      image: { url, visible: Boolean(url), duration: payload.duration, fit },
    });
  }

  hideImage(): void {
    this.setState({ image: { url: null, visible: false, duration: undefined, fit: 'contain' } });
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
    sourceNodeId?: string | null;
    fit?: MediaFit;
  }): void {
    const url = this.resolve(payload.url);
    const sourceNodeIdRaw = payload.sourceNodeId;
    const sourceNodeId =
      typeof sourceNodeIdRaw === 'string' && sourceNodeIdRaw.trim() ? sourceNodeIdRaw.trim() : null;
    const fit = this.coerceFit(payload.fit);
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
        sourceNodeId,
        playing,
        muted: Boolean(payload.muted ?? true),
        loop: Boolean(payload.loop ?? false),
        volume: Math.max(0, Math.min(100, Number(payload.volume ?? 1) || 0)),
        startSec,
        endSec,
        cursorSec,
        reverse,
        fit,
      },
    });
  }

  stopVideo(): void {
    this.setState({
      video: {
        url: null,
        sourceNodeId: null,
        playing: false,
        muted: true,
        loop: false,
        volume: 1,
        startSec: 0,
        endSec: -1,
        cursorSec: -1,
        reverse: false,
        fit: 'contain',
      },
    });
  }

  stopAllMedia(): void {
    this.stopVideo();
    this.hideImage();
  }
}
