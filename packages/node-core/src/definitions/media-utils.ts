/**
 * Purpose: Normalize local media references for display/client asset nodes.
 */

type LocalMediaKind = 'audio' | 'image' | 'video';

function ensureLocalMediaKindQuery(ref: string, kind: LocalMediaKind): string {
  const hashIndex = ref.indexOf('#');
  const hash = hashIndex >= 0 ? ref.slice(hashIndex) : '';
  const withoutHash = hashIndex >= 0 ? ref.slice(0, hashIndex) : ref;

  const qIndex = withoutHash.indexOf('?');
  if (qIndex < 0) return `${withoutHash}?kind=${kind}${hash}`;

  const base = withoutHash.slice(0, qIndex);
  const search = withoutHash.slice(qIndex + 1);
  try {
    const params = new URLSearchParams(search);
    if (!params.has('kind')) params.set('kind', kind);
    return `${base}?${params.toString()}${hash}`;
  } catch {
    const joiner = withoutHash.endsWith('?') || withoutHash.endsWith('&') ? '' : '&';
    return `${withoutHash}${joiner}kind=${kind}${hash}`;
  }
}

function isAbsoluteFilePath(filePath: string): boolean {
  const s = filePath.trim();
  if (!s) return false;
  if (s.startsWith('/')) return true;
  if (/^[a-zA-Z]:[\\/]/.test(s)) return true;
  if (s.startsWith('\\\\')) return true;
  return false;
}

export function normalizeLocalMediaRef(raw: unknown, kind: LocalMediaKind): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return '';

  // Display-local file reference (registered via Manager↔Display local bridge).
  if (s.startsWith('displayfile:')) {
    return ensureLocalMediaKindQuery(s, kind);
  }

  if (s.startsWith('localfile:')) {
    return ensureLocalMediaKindQuery(s, kind);
  }

  const shuguLocalPrefix = 'shugu://local-file/';
  if (s.startsWith(shuguLocalPrefix)) {
    const encoded = s.slice(shuguLocalPrefix.length).trim();
    if (!encoded) return '';
    try {
      const decoded = decodeURIComponent(encoded);
      if (!decoded.trim()) return '';
      return ensureLocalMediaKindQuery(`localfile:${decoded.trim()}`, kind);
    } catch {
      return ensureLocalMediaKindQuery(`localfile:${encoded}`, kind);
    }
  }

  // Local nodes must never fetch remote assets; accept only absolute local paths.
  if (!isAbsoluteFilePath(s)) return '';
  return ensureLocalMediaKindQuery(`localfile:${s}`, kind);
}
