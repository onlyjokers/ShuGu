/**
 * Purpose: MultimediaCore — client-side runtime for assets (resolve + preload + cache + readiness state).
 *
 * This is framework-agnostic (no Svelte). Apps should bridge state into UI/stores if needed.
 */

import { AssetMetaStore } from './indexeddb.js';
import { parseAssetIdFromRef, resolveAssetRefToUrl } from './asset-url-resolver.js';
import { MediaEngine } from './media-engine.js';

export type MultimediaCoreStatus = 'idle' | 'loading' | 'ready' | 'error';

export type MultimediaCoreState = {
  status: MultimediaCoreStatus;
  manifestId: string | null;
  loaded: number;
  total: number;
  error: string | null;
  updatedAt: number;
};

export type AssetManifestInput = {
  manifestId: string;
  assets: string[];
  updatedAt?: number;
};

export type MultimediaCoreConfig = {
  serverUrl: string;
  assetReadToken?: string | null;
  /**
   * Cache Storage bucket name.
   * Must be stable across reloads so we can reuse cached responses.
   */
  cacheName?: string;
  /**
   * Max concurrent downloads.
   * Keep modest to avoid impacting realtime controls.
   */
  concurrency?: number;
  /**
   * Load & start preloading the last manifest immediately.
   */
  autoStart?: boolean;
};

type StateListener = (state: MultimediaCoreState) => void;

const LAST_MANIFEST_KEY = 'shugu-last-asset-manifest-v1';

function normalizeEtag(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const noWeak = trimmed.startsWith('W/') ? trimmed.slice(2).trim() : trimmed;
  const unquoted = noWeak.replace(/^"(.+)"$/, '$1');
  return unquoted || null;
}

function toInt(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.floor(n));
}

type AssetMeta = {
  sha256: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
};

function canUseCacheStorage(): boolean {
  return typeof caches !== 'undefined' && typeof caches.open === 'function';
}

export class MultimediaCore {
  private readonly meta = new AssetMetaStore();
  private readonly listeners = new Set<StateListener>();
  private readonly cacheName: string;
  private readonly concurrency: number;
  private abort: AbortController | null = null;
  private runSeq = 0;

  private serverUrl: string;
  private assetReadToken: string | null;

  private manifest: AssetManifestInput | null = null;
  readonly media: MediaEngine;
  private state: MultimediaCoreState = {
    status: 'idle',
    manifestId: null,
    loaded: 0,
    total: 0,
    error: null,
    updatedAt: Date.now(),
  };

  constructor(config: MultimediaCoreConfig) {
    this.serverUrl = config.serverUrl;
    this.assetReadToken = config.assetReadToken?.trim() ? config.assetReadToken.trim() : null;
    this.cacheName = config.cacheName ?? 'shugu-assets-v1';
    this.concurrency = Math.max(1, Math.min(8, Math.floor(config.concurrency ?? 4)));

    this.media = new MediaEngine({ resolveUrl: (url) => this.resolveAssetRef(url) });

    this.loadLastManifest();
    if (config.autoStart) {
      void this.preloadNow('startup');
    }
  }

  destroy(): void {
    this.abort?.abort();
    this.abort = null;
    this.listeners.clear();
  }

  subscribeState(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  getState(): MultimediaCoreState {
    return this.state;
  }

  setServerUrl(serverUrl: string): void {
    this.serverUrl = serverUrl;
  }

  setAssetReadToken(token: string | null): void {
    this.assetReadToken = token?.trim() ? token.trim() : null;
  }

  setAssetManifest(manifest: AssetManifestInput): void {
    const id = manifest.manifestId?.trim();
    if (!id) return;
    const assets = Array.isArray(manifest.assets) ? manifest.assets.map(String) : [];
    if (this.manifest && this.manifest.manifestId === id) return;
    this.manifest = { manifestId: id, assets, updatedAt: manifest.updatedAt ?? Date.now() };
    this.persistLastManifest();
    void this.preloadNow('manifest-update');
  }

  resolveAssetRef(ref: string): string {
    return resolveAssetRefToUrl(ref, { serverUrl: this.serverUrl, readToken: this.assetReadToken });
  }

  private resolveAssetMetaUrl(assetId: string): string | null {
    const base = (() => {
      try {
        return new URL(this.serverUrl).origin;
      } catch {
        return null;
      }
    })();
    if (!base) return null;
    const url = new URL(`/api/assets/${encodeURIComponent(assetId)}`, base);
    const token = typeof this.assetReadToken === 'string' && this.assetReadToken.trim() ? this.assetReadToken.trim() : null;
    if (token) url.searchParams.set('token', token);
    return url.toString();
  }

  private async fetchAssetSha256(assetId: string, signal: AbortSignal): Promise<string | null> {
    const url = this.resolveAssetMetaUrl(assetId);
    if (!url) return null;
    try {
      const res = await fetch(url, { method: 'GET', signal });
      if (!res.ok) return null;
      const json = (await res.json()) as any;
      const sha = typeof json?.sha256 === 'string' ? json.sha256.trim() : '';
      return sha || null;
    } catch {
      return null;
    }
  }

  private async fetchAssetMeta(assetId: string, signal: AbortSignal): Promise<AssetMeta> {
    const url = this.resolveAssetMetaUrl(assetId);
    if (!url) return { sha256: null, mimeType: null, sizeBytes: null };
    try {
      const res = await fetch(url, { method: 'GET', signal });
      if (!res.ok) return { sha256: null, mimeType: null, sizeBytes: null };
      const json = (await res.json()) as any;
      const sha = typeof json?.sha256 === 'string' ? json.sha256.trim() : '';
      const mimeType = typeof json?.mimeType === 'string' ? json.mimeType.trim() : '';
      const sizeBytesRaw = json?.sizeBytes ?? null;
      const sizeBytes = typeof sizeBytesRaw === 'number' && Number.isFinite(sizeBytesRaw) ? Math.max(0, sizeBytesRaw) : null;
      return {
        sha256: sha || null,
        mimeType: mimeType || null,
        sizeBytes,
      };
    } catch {
      return { sha256: null, mimeType: null, sizeBytes: null };
    }
  }

  async preloadNow(reason: 'startup' | 'manifest-update' | 'manual' = 'manual'): Promise<void> {
    const manifest = this.manifest;
    if (!manifest) return;

    const assets = manifest.assets.slice();
    const total = assets.length;

    if (total === 0) {
      this.setState({ status: 'ready', manifestId: manifest.manifestId, loaded: 0, total: 0, error: null });
      console.log(`[asset] preload ready manifest=${manifest.manifestId} total=0 (reason=${reason})`);
      return;
    }

    // Cancel previous run.
    this.abort?.abort();
    const abort = new AbortController();
    this.abort = abort;
    const runId = ++this.runSeq;

    this.setState({ status: 'loading', manifestId: manifest.manifestId, loaded: 0, total, error: null });
    console.log(`[asset] preload start manifest=${manifest.manifestId} total=${total} (reason=${reason})`);

    let nextIndex = 0;
    let loaded = 0;
    const errors: string[] = [];

    const worker = async () => {
      while (!abort.signal.aborted) {
        const idx = nextIndex;
        nextIndex += 1;
        if (idx >= assets.length) return;

        const ref = assets[idx];
        const assetId = parseAssetIdFromRef(ref);
        if (!assetId) {
          // Non-asset URLs are ignored for now (MVP focuses on Asset Service).
          loaded += 1;
          this.setState({ status: 'loading', manifestId: manifest.manifestId, loaded, total, error: null });
          console.log(`[asset] preload progress ${loaded}/${total} (skip non-asset)`);
          continue;
        }

        try {
          const bytesApprox = await this.ensureCached(assetId, ref, abort.signal);
          loaded += 1;
          this.setState({ status: 'loading', manifestId: manifest.manifestId, loaded, total, error: null });
          const bytesText = bytesApprox ? ` bytes~${bytesApprox}` : '';
          console.log(`[asset] preload progress ${loaded}/${total} asset:${assetId}${bytesText}`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push(`asset:${assetId} ${message}`);
          return;
        }
      }
    };

    await Promise.all(Array.from({ length: this.concurrency }, () => worker()));

    if (abort.signal.aborted || this.runSeq !== runId) return;

    if (errors.length > 0) {
      const error = errors[0] ?? 'unknown error';
      this.setState({ status: 'error', manifestId: manifest.manifestId, loaded, total, error });
      console.warn(`[asset] preload error manifest=${manifest.manifestId}`, error);
      return;
    }

    this.setState({ status: 'ready', manifestId: manifest.manifestId, loaded: total, total, error: null });
    console.log(`[asset] preload ready manifest=${manifest.manifestId} total=${total}`);
  }

  private async ensureCached(assetId: string, ref: string, signal: AbortSignal): Promise<number | null> {
    const url = this.resolveAssetRef(ref);
    const cache = canUseCacheStorage() ? await caches.open(this.cacheName) : null;
    const cacheKey = new Request(url, { method: 'GET' });
    const cached = cache ? await cache.match(cacheKey) : null;

    // Metadata sha256 (baseline consistency check): prefer service-provided sha256.
    // This also guards against "same URL but different content" by requiring ETag === sha256.
    const meta = await this.fetchAssetMeta(assetId, signal);
    const sha256 = meta.sha256;

    const head = await fetch(url, { method: 'HEAD', signal });
    if (!head.ok) throw new Error(`HEAD failed (${head.status})`);

    const etag = normalizeEtag(head.headers.get('etag'));
    const sizeBytes = toInt(head.headers.get('content-length'));

    if (sha256 && etag && sha256 !== etag) {
      // Treat this as invalid/untrusted cache; force a re-fetch below.
      // (Future improvement: allow other ETag strategies by versioning this check.)
      console.warn(`[asset] etag/sha256 mismatch asset:${assetId} etag=${etag} sha256=${sha256}`);
    }

    const localMeta = await this.meta.get(assetId);
    const isMetaValid =
      Boolean(localMeta && localMeta.etag && etag && localMeta.etag === etag) &&
      (localMeta?.sizeBytes ?? null) === (sizeBytes ?? null);
    const hasCachedContent = Boolean(cached);

    // Baseline validation: require ETag to match sha256 when sha256 is available.
    const shaValid = sha256 && etag ? sha256 === etag : true;
    if (isMetaValid && hasCachedContent && shaValid) return meta.sizeBytes ?? sizeBytes ?? null;

    const isVideo = Boolean(meta.mimeType && meta.mimeType.toLowerCase().startsWith('video/'));

    if (isVideo) {
      // For videos, do a lightweight warm-up: confirm headers and optionally preheat the first chunk.
      // We intentionally avoid caching full video blobs in the MVP (can be huge).
      try {
        const range = await fetch(url, { method: 'GET', signal, headers: { Range: 'bytes=0-65535' } });
        if (range.ok) {
          // Consume a small body so the request actually happens (some browsers defer).
          await range.arrayBuffer().catch(() => undefined);
        }
      } catch {
        // Ignore warm-up errors; HEAD/GET at playback time will surface real issues.
      }
    } else {
      const res = await fetch(url, { method: 'GET', signal });
      if (!res.ok) throw new Error(`GET failed (${res.status})`);

      if (cache) {
        await cache.put(cacheKey, res.clone());
      }
    }

    await this.meta.put({
      assetId,
      sha256,
      etag,
      sizeBytes,
      verifiedAt: Date.now(),
    });

    return meta.sizeBytes ?? sizeBytes ?? null;
  }

  private setState(patch: Partial<MultimediaCoreState>): void {
    const next: MultimediaCoreState = { ...this.state, ...patch, updatedAt: Date.now() };
    this.state = next;
    for (const listener of this.listeners) {
      try {
        listener(next);
      } catch {
        // ignore
      }
    }
  }

  private loadLastManifest(): void {
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(LAST_MANIFEST_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as any;
      const manifestId = typeof parsed?.manifestId === 'string' ? parsed.manifestId : '';
      const assets = Array.isArray(parsed?.assets) ? parsed.assets.map(String) : [];
      if (!manifestId) return;
      this.manifest = { manifestId, assets, updatedAt: Number(parsed?.updatedAt ?? Date.now()) };
    } catch {
      // ignore
    }
  }

  private persistLastManifest(): void {
    if (typeof localStorage === 'undefined') return;
    if (!this.manifest) return;
    try {
      localStorage.setItem(LAST_MANIFEST_KEY, JSON.stringify(this.manifest));
    } catch {
      // ignore
    }
  }
}
