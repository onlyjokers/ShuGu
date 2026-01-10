import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common';
import { GeoService, type GeoFenceConfig } from '../geo/geo.service.js';
import type { VisualSceneLayerItem } from '@shugu/protocol';
import { BootstrapService, type VisualBootstrapConfig } from './bootstrap.service.js';

type BootstrapConfigResponse = {
  fence: GeoFenceConfig | null;
  visual: VisualBootstrapConfig | null;
};

@Controller('bootstrap')
export class BootstrapController {
  constructor(
    private readonly geoService: GeoService,
    private readonly bootstrapService: BootstrapService
  ) {}

  @Get('config')
  getConfig(): BootstrapConfigResponse {
    return {
      fence: this.geoService.getGeoFence(),
      visual: this.bootstrapService.getVisual(),
    };
  }

  @Post('visual')
  setVisual(@Body() body: unknown): { visual: VisualBootstrapConfig | null } {
    if (body && typeof body === 'object' && (body as any).enabled === false) {
      this.bootstrapService.clearVisual();
      return { visual: null };
    }

    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Invalid body');
    }

    const scenesRaw = (body as any).scenes;
    const asciiEnabled = (body as any).asciiEnabled;
    const asciiResolution = (body as any).asciiResolution;

    if (!Array.isArray(scenesRaw)) {
      throw new BadRequestException('Invalid body.scenes');
    }
    if (typeof asciiEnabled !== 'boolean') {
      throw new BadRequestException('Invalid body.asciiEnabled');
    }
    if (
      typeof asciiResolution !== 'number' ||
      !Number.isFinite(asciiResolution) ||
      asciiResolution < 1 ||
      asciiResolution > 200
    ) {
      throw new BadRequestException('Invalid body.asciiResolution');
    }

    const allowedSceneTypes = new Set(['box', 'mel', 'frontCamera', 'backCamera']);
    const scenes = scenesRaw.slice(0, 12).map((raw: unknown) => {
      if (!raw || typeof raw !== 'object') throw new BadRequestException('Invalid body.scenes item');
      const type = typeof (raw as any).type === 'string' ? String((raw as any).type) : '';
      if (!allowedSceneTypes.has(type)) {
        throw new BadRequestException(`Invalid body.scenes type: ${type}`);
      }
      return { type } as VisualSceneLayerItem;
    });

    return {
      visual: this.bootstrapService.setVisual({
        scenes,
        asciiEnabled,
        asciiResolution,
      }),
    };
  }
}
