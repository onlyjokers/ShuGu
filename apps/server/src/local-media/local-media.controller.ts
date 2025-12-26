/**
 * Purpose: Local Media HTTP API — list/validate and stream local files with Range support.
 *
 * This is used by "Load * From Local (Display only)" nodes.
 */

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Head,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { requireAssetReadAuth, requireAssetWriteAuth } from '../assets/assets.auth.js';
import { AssetsService } from '../assets/assets.service.js';
import { parseByteRangeHeader } from '../assets/range.js';
import { LocalMediaService } from './local-media.service.js';
import type { LocalMediaKind } from './local-media.config.js';

type HeaderRequest = {
  header: (name: string) => string | undefined;
  get: (name: string) => string | undefined;
  protocol: string;
} & Record<string, unknown>;

type RawResponse = any;

function toContentDispositionFilename(filePath: string): string {
  const base = path.basename(filePath || '').replace(/[\r\n"]/g, '_');
  return base || 'media';
}

function parseLocalPathQuery(req: any): string {
  const q = (req as any)?.query ?? null;
  const raw = q?.path ?? null;
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0];
  return '';
}

@Controller('api/local-media')
export class LocalMediaController {
  constructor(
    private readonly assets: AssetsService,
    private readonly localMedia: LocalMediaService
  ) {}

  @Get()
  async list(@Req() req: any): Promise<{ files: any[]; roots: string[] }> {
    requireAssetWriteAuth(req, this.assets.config.writeToken);
    const kindRaw =
      typeof (req as any)?.query?.kind === 'string' ? String((req as any).query.kind) : '';
    const kind: LocalMediaKind | null =
      kindRaw === 'audio' || kindRaw === 'image' || kindRaw === 'video' ? kindRaw : null;
    const files = await this.localMedia.listFiles({ kind });
    return { files, roots: this.localMedia.getRoots() };
  }

  @Post('validate')
  async validate(@Body() body: any, @Req() req: any): Promise<{ file: any }> {
    requireAssetWriteAuth(req, this.assets.config.writeToken);
    const rawPath = typeof body?.path === 'string' ? body.path : '';
    const kindRaw = typeof body?.kind === 'string' ? body.kind : '';
    const kind: LocalMediaKind | null =
      kindRaw === 'audio' || kindRaw === 'image' || kindRaw === 'video' ? kindRaw : null;
    if (!kind) throw new BadRequestException('invalid kind');

    const validated = await this.localMedia.validatePath(rawPath, kind);
    return {
      file: {
        path: validated.realPath,
        kind: validated.kind,
        mimeType: validated.mimeType,
        sizeBytes: validated.sizeBytes,
        modifiedAt: validated.modifiedAt,
        etag: validated.etag,
      },
    };
  }

  @Head('content')
  async headContent(@Req() req: HeaderRequest, @Res() res: RawResponse): Promise<void> {
    requireAssetReadAuth(req as any, this.assets.config.readToken);
    const rawPath = parseLocalPathQuery(req);
    const kindRaw =
      typeof (req as any)?.query?.kind === 'string' ? String((req as any).query.kind) : '';
    const kind: LocalMediaKind | null =
      kindRaw === 'audio' || kindRaw === 'image' || kindRaw === 'video' ? kindRaw : null;

    const validated = await this.localMedia.validatePath(rawPath, kind);
    const stat = await fsp.stat(validated.realPath).catch(() => null);
    if (!stat || !stat.isFile()) throw new BadRequestException('file not found');

    const etagHeader = `"${validated.etag}"`;
    const ifNoneMatch = this.localMedia.parseIfNoneMatch(req);
    if (ifNoneMatch && ifNoneMatch === validated.etag) {
      res.status(304);
      res.setHeader('ETag', etagHeader);
      res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
      res.end();
      return;
    }

    res.status(200);
    res.setHeader('Content-Type', validated.mimeType);
    res.setHeader('Content-Length', String(stat.size));
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('ETag', etagHeader);
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${toContentDispositionFilename(validated.realPath)}"`
    );
    res.end();
  }

  @Get('content')
  async getContent(@Req() req: HeaderRequest, @Res() res: RawResponse): Promise<void> {
    requireAssetReadAuth(req as any, this.assets.config.readToken);
    const rawPath = parseLocalPathQuery(req);
    const kindRaw =
      typeof (req as any)?.query?.kind === 'string' ? String((req as any).query.kind) : '';
    const kind: LocalMediaKind | null =
      kindRaw === 'audio' || kindRaw === 'image' || kindRaw === 'video' ? kindRaw : null;

    const validated = await this.localMedia.validatePath(rawPath, kind);
    const stat = await fsp.stat(validated.realPath).catch(() => null);
    if (!stat || !stat.isFile()) throw new BadRequestException('file not found');

    const etagHeader = `"${validated.etag}"`;
    const ifNoneMatch = this.localMedia.parseIfNoneMatch(req);
    if (ifNoneMatch && ifNoneMatch === validated.etag) {
      res.status(304);
      res.setHeader('ETag', etagHeader);
      res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
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

    res.setHeader('Content-Type', validated.mimeType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('ETag', etagHeader);
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${toContentDispositionFilename(validated.realPath)}"`
    );

    if (!range) {
      res.status(200);
      res.setHeader('Content-Length', String(stat.size));
      fs.createReadStream(validated.realPath).pipe(res);
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
    fs.createReadStream(validated.realPath, { start, end }).pipe(res);
  }
}

