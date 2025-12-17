import { Injectable } from '@nestjs/common';

type ReverseGeocodeParams = {
  lat: number;
  lng: number;
  lang: string;
  zoom: number;
};

export type ReverseGeocodeResponse = {
  provider: 'nominatim' | 'fallback';
  lat: number;
  lng: number;
  formattedAddress: string;
  displayName?: string;
  details?: {
    country?: string;
    state?: string;
    city?: string;
    district?: string;
    neighbourhood?: string;
    road?: string;
    houseNumber?: string;
    building?: string;
    poi?: string;
    postcode?: string;
  };
  error?: string;
};

type NominatimReverseResponse = {
  lat?: string;
  lon?: string;
  display_name?: string;
  name?: string;
  address?: Record<string, string | undefined>;
};

export type GeoFenceConfig = {
  center: {
    lat: number;
    lng: number;
  };
  rangeM: number;
  address?: string | null;
  updatedAt: number;
};

@Injectable()
export class GeoService {
  // Nominatim is rate-limited; cache + inflight de-dupe avoids hammering it.
  private readonly cache = new Map<string, { expiresAt: number; value: ReverseGeocodeResponse }>();
  private readonly inflight = new Map<string, Promise<ReverseGeocodeResponse>>();
  private lastRequestAt = 0;

  private geoFence: GeoFenceConfig | null = null;

  getGeoFence(): GeoFenceConfig | null {
    return this.geoFence;
  }

  setGeoFence(input: Omit<GeoFenceConfig, 'updatedAt'>): GeoFenceConfig {
    const next: GeoFenceConfig = {
      center: input.center,
      rangeM: input.rangeM,
      address: input.address ?? null,
      updatedAt: Date.now(),
    };
    this.geoFence = next;
    return next;
  }

  clearGeoFence(): void {
    this.geoFence = null;
  }

  async reverseGeocode(params: ReverseGeocodeParams): Promise<ReverseGeocodeResponse> {
    const key = this.buildCacheKey(params);
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const inflight = this.inflight.get(key);
    if (inflight) return inflight;

    const promise = this.reverseGeocodeUncached(params)
      .then((value) => {
        // Cache for 6 hours (addresses are stable enough for our use).
        this.cache.set(key, { expiresAt: Date.now() + 6 * 60 * 60 * 1000, value });
        return value;
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn('[GeoService] reverse geocode failed; falling back to lat/lng', {
          lat: params.lat,
          lng: params.lng,
          lang: params.lang,
          zoom: params.zoom,
          error: message,
        });

        const value = this.fallbackReverseGeocode(params, message);
        // Cache fallback briefly to avoid repeated server-side 500s on dashboards.
        this.cache.set(key, { expiresAt: Date.now() + 2 * 60 * 1000, value });
        return value;
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    this.inflight.set(key, promise);
    return promise;
  }

  private buildCacheKey(params: ReverseGeocodeParams): string {
    // 6 decimals ~ 0.11m at equator; plenty for display while keeping cache hit rate high.
    const lat = params.lat.toFixed(6);
    const lng = params.lng.toFixed(6);
    const lang = (params.lang || 'zh-CN').toLowerCase();
    const zoom = String(params.zoom ?? 18);
    return `${lat},${lng}|${lang}|${zoom}`;
  }

  private async reverseGeocodeUncached(params: ReverseGeocodeParams): Promise<ReverseGeocodeResponse> {
    const baseUrl = process.env.NOMINATIM_BASE_URL || 'https://nominatim.openstreetmap.org';
    const contactEmail = process.env.NOMINATIM_EMAIL || '';
    const userAgent =
      process.env.NOMINATIM_USER_AGENT ||
      `ShuGu/1.0 (reverse geocode${contactEmail ? `; contact: ${contactEmail}` : ''})`;

    const url = new URL('/reverse', baseUrl);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('lat', String(params.lat));
    url.searchParams.set('lon', String(params.lng));
    url.searchParams.set('zoom', String(params.zoom));
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('accept-language', params.lang || 'zh-CN');
    if (contactEmail) url.searchParams.set('email', contactEmail);

    await this.waitForRateLimit(1100);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Accept-Language': params.lang || 'zh-CN',
        'User-Agent': userAgent,
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Reverse geocode failed (${response.status}): ${body || response.statusText}`);
    }

    const json = (await response.json()) as NominatimReverseResponse;
    const { formattedAddress, details } = this.formatAddress(json, params.lang);

    return {
      provider: 'nominatim',
      lat: params.lat,
      lng: params.lng,
      formattedAddress,
      displayName: json.display_name,
      details,
    };
  }

  private fallbackReverseGeocode(
    params: ReverseGeocodeParams,
    errorMessage?: string
  ): ReverseGeocodeResponse {
    const formatted = `${params.lat.toFixed(6)}, ${params.lng.toFixed(6)}`;
    return {
      provider: 'fallback',
      lat: params.lat,
      lng: params.lng,
      formattedAddress: formatted,
      displayName: formatted,
      error: errorMessage,
    };
  }

  private async waitForRateLimit(minIntervalMs: number): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestAt;
    if (elapsed >= minIntervalMs) {
      this.lastRequestAt = now;
      return;
    }
    const waitMs = minIntervalMs - elapsed;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    this.lastRequestAt = Date.now();
  }

  private formatAddress(
    json: NominatimReverseResponse,
    lang: string
  ): { formattedAddress: string; details?: ReverseGeocodeResponse['details'] } {
    const address = json.address ?? {};

    const country = address.country;
    const state = address.state || address.region || address.province;
    const city =
      address.city ||
      address.town ||
      address.village ||
      address.municipality ||
      address.city_district;
    const district =
      address.city_district ||
      address.district ||
      address.borough ||
      address.county ||
      address.state_district;
    const neighbourhood =
      address.neighbourhood || address.suburb || address.quarter || address.hamlet || address.locality;
    const road = address.road || address.pedestrian || address.footway;
    const houseNumber = address.house_number;
    const building = address.building;
    const poi =
      address.house_name ||
      address.amenity ||
      address.shop ||
      address.tourism ||
      address.leisure ||
      address.historic ||
      address.man_made ||
      address.office ||
      json.name;
    const postcode = address.postcode;

    const parts: string[] = [];
    const seen = new Set<string>();

    const push = (value?: string) => {
      const v = value?.trim();
      if (!v) return;
      if (seen.has(v)) return;
      seen.add(v);
      parts.push(v);
    };

    // Roughly "country -> province/state -> city -> district -> neighbourhood -> road -> house -> poi".
    push(country);
    push(state);
    push(city);
    push(district);
    push(neighbourhood);
    push(road);
    push(houseNumber);
    push(building);
    push(poi);

    // Prefer our structured build; fall back to provider display_name if missing.
    const prefersChineseFormat = (lang || '').toLowerCase().startsWith('zh');
    const formattedAddress = parts.length
      ? prefersChineseFormat
        ? parts.join('')
        : parts.join(', ')
      : json.display_name || `${json.lat ?? ''},${json.lon ?? ''}`;

    return {
      formattedAddress,
      details: {
        country,
        state,
        city,
        district,
        neighbourhood,
        road,
        houseNumber,
        building,
        poi,
        postcode,
      },
    };
  }
}
