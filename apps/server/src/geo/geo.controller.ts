import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { GeoService } from './geo.service.js';

@Controller('geo')
export class GeoController {
  constructor(private readonly geoService: GeoService) {}

  /**
   * Reverse geocode coordinates to a human-readable address.
   * This is used by both Manager UI and Client devices to display precise locations.
   */
  @Get('reverse')
  async reverse(
    @Query('lat') latRaw: string,
    @Query('lng') lngRaw: string,
    @Query('lang') lang = 'zh-CN',
    @Query('zoom') zoomRaw?: string
  ) {
    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      throw new BadRequestException('Invalid query param: lat');
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      throw new BadRequestException('Invalid query param: lng');
    }

    const zoom = zoomRaw ? Number(zoomRaw) : 18;
    if (!Number.isFinite(zoom) || zoom < 3 || zoom > 18) {
      throw new BadRequestException('Invalid query param: zoom');
    }

    return this.geoService.reverseGeocode({ lat, lng, lang, zoom });
  }
}

