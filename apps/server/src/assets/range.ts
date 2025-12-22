/**
 * Purpose: Parse RFC 7233 Range header (bytes) for streaming asset content.
 */

export type ByteRange = { start: number; end: number };

export function parseByteRangeHeader(header: string, sizeBytes: number): ByteRange | null {
  const raw = header.trim();
  if (!raw) return null;
  const match = /^bytes=(.+)$/i.exec(raw);
  if (!match) return null;

  // Only support the first range for MVP.
  const first = match[1].split(',')[0]?.trim();
  if (!first) return null;

  const [startRaw, endRaw] = first.split('-').map((p) => p.trim());
  if (startRaw === '' && endRaw === '') return null;

  // Suffix range: "-N" => last N bytes.
  if (startRaw === '') {
    const suffixLength = Number(endRaw);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    const length = Math.min(sizeBytes, Math.floor(suffixLength));
    return { start: Math.max(0, sizeBytes - length), end: sizeBytes - 1 };
  }

  const start = Number(startRaw);
  if (!Number.isFinite(start) || start < 0) return null;
  const startInt = Math.floor(start);
  if (startInt >= sizeBytes) return null;

  // Open-ended: "N-" => to end.
  if (endRaw === '') {
    return { start: startInt, end: sizeBytes - 1 };
  }

  const end = Number(endRaw);
  if (!Number.isFinite(end) || end < 0) return null;
  const endInt = Math.floor(end);
  if (endInt < startInt) return null;
  return { start: startInt, end: Math.min(endInt, sizeBytes - 1) };
}

