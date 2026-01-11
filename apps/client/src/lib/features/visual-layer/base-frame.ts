/**
 * Purpose: Base visual layer composition (scenes + media + camera) for VisualCanvas.
 */

import type { MediaFit } from '@shugu/multimedia-core';

export type BaseFrameVideoState = {
  url: string | null;
  fit?: MediaFit | null;
};

export type BaseFrameImageState = {
  url: string | null;
  visible?: boolean;
  fit?: MediaFit | null;
  scale?: number;
  offsetX?: number;
  offsetY?: number;
  opacity?: number;
};

export type BaseFrameSources = {
  container: HTMLElement | null;
  effectCanvas: HTMLCanvasElement | null;
  cameraVideoElement: HTMLVideoElement | null;
  videoState: BaseFrameVideoState;
  imageState: BaseFrameImageState;
  cameraStream: MediaStream | null;
  frontCameraEnabled: boolean;
  backCameraEnabled: boolean;
};

export type FittedDrawParams = {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
};

export function getFittedDrawParams(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  fit: MediaFit
): FittedDrawParams {
  if (fit === 'fill') {
    return { sx: 0, sy: 0, sw: srcW, sh: srcH, dx: 0, dy: 0, dw: dstW, dh: dstH };
  }

  if (fit === 'cover') {
    const scale = Math.max(dstW / srcW, dstH / srcH);
    const sw = dstW / scale;
    const sh = dstH / scale;
    const sx = (srcW - sw) / 2;
    const sy = (srcH - sh) / 2;
    return { sx, sy, sw, sh, dx: 0, dy: 0, dw: dstW, dh: dstH };
  }

  // contain: preserve aspect ratio and don't scale up beyond 1x.
  if (fit === 'contain') {
    const scale = Math.min(1, dstW / srcW, dstH / srcH);
    const dw = srcW * scale;
    const dh = srcH * scale;
    const dx = (dstW - dw) / 2;
    const dy = (dstH - dh) / 2;
    return { sx: 0, sy: 0, sw: srcW, sh: srcH, dx, dy, dw, dh };
  }

  // fit-screen: preserve aspect ratio and scale up to fit the screen.
  const scale = Math.min(dstW / srcW, dstH / srcH);
  const dw = srcW * scale;
  const dh = srcH * scale;
  const dx = (dstW - dw) / 2;
  const dy = (dstH - dh) / 2;
  return { sx: 0, sy: 0, sw: srcW, sh: srcH, dx, dy, dw, dh };
}

export function drawBaseFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  dpr: number,
  sources: BaseFrameSources
): void {
  const {
    container,
    effectCanvas,
    cameraVideoElement,
    videoState,
    imageState,
    cameraStream,
    frontCameraEnabled,
    backCameraEnabled,
  } = sources;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#0a0a0f';
  ctx.fillRect(0, 0, width, height);

  // Draw any mounted scene canvases first (Box, Mel, ...).
  const sceneCanvases = Array.from(container?.querySelectorAll('canvas') ?? []) as HTMLCanvasElement[];
  for (const c of sceneCanvases) {
    if (c === effectCanvas) continue;
    if (!c.width || !c.height) continue;
    try {
      ctx.drawImage(c, 0, 0, width, height);
    } catch {
      // ignore
    }
  }

  // Draw video (if any) on top of scenes.
  const video = container?.querySelector('.video-overlay video') as HTMLVideoElement | null;
  if (video && videoState.url && video.readyState >= 2) {
    const srcW = video.videoWidth || 0;
    const srcH = video.videoHeight || 0;
    if (srcW > 0 && srcH > 0) {
      const fit = (videoState.fit ?? 'contain') as MediaFit;
      const padding = fit === 'contain' ? 24 : 0;
      const dstW = Math.max(0, width - padding * 2);
      const dstH = Math.max(0, height - padding * 2);
      if (dstW > 0 && dstH > 0) {
        const { sx, sy, sw, sh, dx, dy, dw, dh } = getFittedDrawParams(
          srcW,
          srcH,
          dstW,
          dstH,
          fit
        );
        try {
          ctx.drawImage(video, sx, sy, sw, sh, padding + dx, padding + dy, dw, dh);
        } catch {
          // cross-origin without CORS
        }
      }
    }
  }

  // Draw image (if any) on top of video.
  const img = container?.querySelector('.image-overlay img') as HTMLImageElement | null;
  if (img && imageState.visible && imageState.url) {
    const srcW = img.naturalWidth || img.clientWidth || 0;
    const srcH = img.naturalHeight || img.clientHeight || 0;
    if (srcW > 0 && srcH > 0) {
      const fit = (imageState.fit ?? 'contain') as MediaFit;
      const padding = fit === 'contain' ? 24 : 0;
      const dstW = Math.max(0, width - padding * 2);
      const dstH = Math.max(0, height - padding * 2);
      if (dstW > 0 && dstH > 0) {
        const { sx, sy, sw, sh, dx, dy, dw, dh } = getFittedDrawParams(
          srcW,
          srcH,
          dstW,
          dstH,
          fit
        );

        const scale = (() => {
          const raw = typeof imageState.scale === 'number' ? imageState.scale : 1;
          return Number.isFinite(raw) ? Math.max(0.1, Math.min(10, raw)) : 1;
        })();
        const offsetX = (() => {
          const raw = typeof imageState.offsetX === 'number' ? imageState.offsetX : 0;
          return Number.isFinite(raw) ? raw : 0;
        })();
        const offsetY = (() => {
          const raw = typeof imageState.offsetY === 'number' ? imageState.offsetY : 0;
          return Number.isFinite(raw) ? raw : 0;
        })();
        const opacity = (() => {
          const raw = typeof imageState.opacity === 'number' ? imageState.opacity : 1;
          return Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 1;
        })();

        const centerX = padding + dx + dw / 2;
        const centerY = padding + dy + dh / 2;
        const scaledW = dw * scale;
        const scaledH = dh * scale;
        const drawX = centerX - scaledW / 2 + offsetX;
        const drawY = centerY - scaledH / 2 + offsetY;

        try {
          ctx.save();
          ctx.globalAlpha = opacity;
          ctx.drawImage(img, sx, sy, sw, sh, drawX, drawY, scaledW, scaledH);
          ctx.restore();
        } catch {
          // cross-origin without CORS
        }
      }
    }
  }

  // Draw camera on top (if enabled).
  if (
    cameraVideoElement &&
    cameraStream &&
    (frontCameraEnabled || backCameraEnabled) &&
    cameraVideoElement.readyState >= 2
  ) {
    const srcW = cameraVideoElement.videoWidth || 0;
    const srcH = cameraVideoElement.videoHeight || 0;
    if (srcW > 0 && srcH > 0) {
      const { sx, sy, sw, sh, dx, dy, dw, dh } = getFittedDrawParams(
        srcW,
        srcH,
        width,
        height,
        'cover'
      );
      try {
        ctx.save();
        if (frontCameraEnabled) {
          ctx.translate(width, 0);
          ctx.scale(-1, 1);
        }
        ctx.drawImage(cameraVideoElement, sx, sy, sw, sh, dx, dy, dw, dh);
        ctx.restore();
      } catch {
        // ignore
      }
    }
  }
}
