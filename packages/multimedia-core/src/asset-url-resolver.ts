/**
 * Purpose: Resolve ShuGu `asset:` references to concrete HTTP(S) URLs.
 *
 * This is intentionally small and dependency-free so it can be reused by:
 * - Multimedia preload/cache
 * - Tone.js audio nodes
 * - HTML image/video elements
 */

export type ResolveAssetRefOptions = {
  serverUrl: string;
  /**
   * Optional read token. When provided, it is appended as a query param
   * so media elements (img/video/audio) can load without custom headers.
   */
  readToken?: string | null;
};

export function normalizeAssetRef(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  if (s.startsWith('asset:')) {
    const id = s.slice('asset:'.length).trim().split(/[?#]/)[0]?.trim() ?? '';
    return id ? `asset:${id}` : null;
  }

  const shuguPrefix = 'shugu://asset/';
  if (s.startsWith(shuguPrefix)) {
    const id = s.slice(shuguPrefix.length).trim().split(/[?#]/)[0]?.trim() ?? '';
    return id ? `asset:${id}` : null;
  }

  return null;
}

export function parseAssetIdFromRef(raw: string): string | null {
  const normalized = normalizeAssetRef(raw);
  if (!normalized) return null;
  const id = normalized.slice('asset:'.length).trim();
  return id ? id : null;
}

export function resolveAssetRefToUrl(raw: string, opts: ResolveAssetRefOptions): string {
  const normalized = normalizeAssetRef(raw);
  if (!normalized) return raw;

  const id = normalized.slice('asset:'.length).trim();
  if (!id) return raw;

  const base = (() => {
    try {
      return new URL(opts.serverUrl).origin;
    } catch {
      return null;
    }
  })();

  if (!base) return raw;

  const url = new URL(`/api/assets/${encodeURIComponent(id)}/content`, base);
  const token = typeof opts.readToken === 'string' && opts.readToken.trim() ? opts.readToken.trim() : null;
  if (token) url.searchParams.set('token', token);
  return url.toString();
}
