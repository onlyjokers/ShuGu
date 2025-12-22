/**
 * Purpose: Low-latency bearer-token auth helpers for Asset Service endpoints.
 */

import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

type HeaderRequest = { header: (name: string) => string | undefined } & Record<string, unknown>;

function parseBearerToken(req: HeaderRequest): string | null {
  const header = req.header('authorization') ?? req.header('Authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const token = match[1]?.trim();
  return token ? token : null;
}

function parseQueryToken(req: HeaderRequest): string | null {
  const query: any = (req as any).query ?? null;
  if (!query || typeof query !== 'object') return null;
  const raw = query.token ?? query.access_token ?? null;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (Array.isArray(raw) && typeof raw[0] === 'string' && raw[0].trim()) return raw[0].trim();
  return null;
}

function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export function requireAssetReadAuth(req: HeaderRequest, expectedToken: string | null): void {
  // Public-read by default: if ASSET_READ_TOKEN is not configured, allow all read requests.
  // This matches the common pattern: write protected, read public.
  if (!expectedToken) return;

  const token = parseBearerToken(req) ?? parseQueryToken(req);
  if (!token || !constantTimeEqual(token, expectedToken)) {
    throw new UnauthorizedException('invalid asset read token');
  }
}

export function requireAssetWriteAuth(req: HeaderRequest, expectedToken: string | null): void {
  if (!expectedToken) {
    throw new ServiceUnavailableException(
      'asset service auth is not configured (ASSET_WRITE_TOKEN)'
    );
  }
  const token = parseBearerToken(req);
  if (!token || !constantTimeEqual(token, expectedToken)) {
    throw new UnauthorizedException('invalid asset write token');
  }
}
