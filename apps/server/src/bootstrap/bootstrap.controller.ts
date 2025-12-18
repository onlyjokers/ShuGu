import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common';
import { GeoService, type GeoFenceConfig } from '../geo/geo.service.js';
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

    const sceneId = (body as any).sceneId;
    const asciiEnabled = (body as any).asciiEnabled;
    const asciiResolution = (body as any).asciiResolution;

    if (typeof sceneId !== 'string' || sceneId.trim().length === 0 || sceneId.length > 64) {
      throw new BadRequestException('Invalid body.sceneId');
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

    return {
      visual: this.bootstrapService.setVisual({
        sceneId: sceneId.trim(),
        asciiEnabled,
        asciiResolution,
      }),
    };
  }
}

