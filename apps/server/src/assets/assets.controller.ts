/**
 * Purpose: Asset Service HTTP API (upload + metadata + content with Range/ETag).
 */

import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Head,
  NotFoundException,
  Param,
  PayloadTooLargeException,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AssetKind } from './assets.types.js';
import { AssetsService } from './assets.service.js';
import { requireAssetReadAuth, requireAssetWriteAuth } from './assets.auth.js';
import { parseByteRangeHeader } from './range.js';
import { readAssetServiceConfig } from './assets.config.js';

const UPLOAD_TMP_DIR = path.join(os.tmpdir(), 'shugu-assets-upload');
try {
  fs.mkdirSync(UPLOAD_TMP_DIR, { recursive: true });
} catch {
  // ignore
}
const MAX_UPLOAD_BYTES = readAssetServiceConfig().maxBytes;

function normalizeEtag(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Handle weak etags and quoted values.
  const noWeak = trimmed.startsWith('W/') ? trimmed.slice(2).trim() : trimmed;
  const unquoted = noWeak.replace(/^"(.+)"$/, '$1');
  return unquoted || null;
}

type HeaderRequest = {
  header: (name: string) => string | undefined;
  get: (name: string) => string | undefined;
  protocol: string;
} & Record<string, unknown>;

type RawResponse = any;

function buildPublicBaseUrl(req: HeaderRequest, configuredBaseUrl: string | null): string {
  if (configuredBaseUrl) return configuredBaseUrl;
  const forwardedProto = req.header('x-forwarded-proto');
  const forwardedHost = req.header('x-forwarded-host');
  const proto = forwardedProto ? forwardedProto.split(',')[0].trim() : req.protocol;
  const host = forwardedHost ? forwardedHost.split(',')[0].trim() : req.get('host');
  return `${proto}://${host}`;
}

function toContentDispositionFilename(originalName: string): string {
  const base = path.basename(originalName || '').replace(/[\r\n"]/g, '_');
  // Ensure the quoted filename value is ASCII-only to satisfy Node's header validation.
  const ascii = base.replace(/[^\x20-\x7E]/g, '_').trim();
  return ascii || 'asset';
}

function toContentDispositionFilenameStar(originalName: string): string | null {
  const base = path.basename(originalName || '').replace(/[\r\n"]/g, '_').trim();
  if (!base) return null;
  return `UTF-8''${encodeURIComponent(base)}`;
}

function buildContentDisposition(originalName: string): string {
  const fallback = toContentDispositionFilename(originalName);
  const star = toContentDispositionFilenameStar(originalName);
  if (!star) return `inline; filename="${fallback}"`;
  return `inline; filename="${fallback}"; filename*=${star}`;
}

@Controller('api/assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get()
  async list(@Req() req: any): Promise<{ assets: any[] }> {
    requireAssetWriteAuth(req, this.assets.config.writeToken);
    return { assets: this.assets.listAssets() };
  }

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      dest: UPLOAD_TMP_DIR,
      limits: { fileSize: MAX_UPLOAD_BYTES },
    })
  )
  async upload(
    @UploadedFile() file: any,
    @Req() req: any
  ): Promise<{ asset: any; contentUrl: string; deduped: boolean }> {
    requireAssetWriteAuth(req, this.assets.config.writeToken);

    if (!file) throw new BadRequestException('missing file');
    const mimeType = typeof file.mimetype === 'string' ? file.mimetype : 'application/octet-stream';
    const originalName =
      typeof (req.body as any)?.originalName === 'string'
        ? String((req.body as any).originalName)
        : typeof file.originalname === 'string'
          ? file.originalname
          : 'asset';

    const kindRaw = typeof (req.body as any)?.kind === 'string' ? String((req.body as any).kind) : '';
    const kind: AssetKind | null =
      kindRaw === 'audio' || kindRaw === 'image' || kindRaw === 'video' ? kindRaw : null;

    let result: { asset: any; deduped: boolean };
    try {
      result = await this.assets.uploadFromTempFile({
        tempPath: file.path,
        mimeType,
        originalName,
        kind,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith('asset too large')) {
        throw new PayloadTooLargeException(message);
      }
      throw err;
    }

    const baseUrl = buildPublicBaseUrl(req, this.assets.config.publicBaseUrl);
    const contentUrl = `${baseUrl}/api/assets/${result.asset.id}/content`;
    return { asset: result.asset, contentUrl, deduped: result.deduped };
  }

  @Delete(':id')
  async delete(@Param('id') id: string, @Req() req: any): Promise<{ deleted: boolean }> {
    requireAssetWriteAuth(req, this.assets.config.writeToken);
    return await this.assets.deleteAsset(id);
  }

  @Get(':id')
  async getMeta(@Param('id') id: string, @Req() req: any): Promise<any> {
    requireAssetReadAuth(req, this.assets.config.readToken);
    const asset = this.assets.getAssetRecord(id);
    if (!asset) throw new NotFoundException('asset not found');
    return asset;
  }

  @Head(':id/content')
  async headContent(
    @Param('id') id: string,
    @Req() req: any,
    @Res() res: RawResponse
  ): Promise<void> {
    requireAssetReadAuth(req, this.assets.config.readToken);
    const info = this.assets.getContentHeaders(id);
    if (!info) throw new NotFoundException('asset not found');

    const stored = info.stored;
    const filePath = info.filePath;
    const stat = await fsp.stat(filePath).catch(() => null);
    if (!stat || !stat.isFile()) throw new NotFoundException('asset content not found');

    const etag = `"${stored.sha256}"`;
    const ifNoneMatch = normalizeEtag(req.header('if-none-match'));
    if (ifNoneMatch && ifNoneMatch === stored.sha256) {
      res.status(304);
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.end();
      return;
    }

    res.status(200);
    res.setHeader('Content-Type', stored.mimeType);
    res.setHeader('Content-Length', String(stat.size));
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Content-Disposition', buildContentDisposition(stored.originalName));
    res.end();
  }

  @Get(':id/content')
  async getContent(
    @Param('id') id: string,
    @Req() req: any,
    @Res() res: RawResponse
  ): Promise<void> {
    requireAssetReadAuth(req, this.assets.config.readToken);
    const info = this.assets.getContentHeaders(id);
    if (!info) throw new NotFoundException('asset not found');

    const stored = info.stored;
    const filePath = info.filePath;
    const stat = await fsp.stat(filePath).catch(() => null);
    if (!stat || !stat.isFile()) throw new NotFoundException('asset content not found');

    const etag = `"${stored.sha256}"`;
    const ifNoneMatch = normalizeEtag(req.header('if-none-match'));
    if (ifNoneMatch && ifNoneMatch === stored.sha256) {
      res.status(304);
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.end();
      return;
    }

    const rangeHeader = req.header('range');
    const range = rangeHeader ? parseByteRangeHeader(rangeHeader, stat.size) : null;
    if (rangeHeader && !range) {
      res.status(416);
      res.setHeader('Content-Range', `bytes */${stat.size}`);
      res.end();
      return;
    }

    res.setHeader('Content-Type', stored.mimeType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Content-Disposition', buildContentDisposition(stored.originalName));

    if (!range) {
      res.status(200);
      res.setHeader('Content-Length', String(stat.size));
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    if (range.start < 0 || range.end < 0) {
      throw new BadRequestException('invalid range');
    }

    if (range.start >= stat.size) {
      res.status(416);
      res.setHeader('Content-Range', `bytes */${stat.size}`);
      res.end();
      return;
    }

    const start = range.start;
    const end = Math.min(range.end, stat.size - 1);
    const chunkSize = end - start + 1;

    res.status(206);
    res.setHeader('Content-Length', String(chunkSize));
    res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    fs.createReadStream(filePath, { start, end }).pipe(res);
  }
}
