/**
 * Purpose: Client-side 3x3 convolution post-processing helpers.
 *
 * Used by `VisualCanvas.svelte` to apply a customizable convolution kernel to the currently
 * rendered frame (scene/video/image/ascii output).
 */

export type ConvolutionPreset =
  | 'blur'
  | 'gaussianBlur'
  | 'sharpen'
  | 'edge'
  | 'emboss'
  | 'sobelX'
  | 'sobelY'
  | 'custom';

export const CONVOLUTION_PRESET_KERNELS: Record<Exclude<ConvolutionPreset, 'custom'>, number[]> = {
  blur: [1, 1, 1, 1, 1, 1, 1, 1, 1],
  gaussianBlur: [1, 2, 1, 2, 4, 2, 1, 2, 1],
  sharpen: [0, -1, 0, -1, 5, -1, 0, -1, 0],
  edge: [-1, -1, -1, -1, 8, -1, -1, -1, -1],
  emboss: [-2, -1, 0, -1, 1, 1, 0, 1, 2],
  sobelX: [-1, 0, 1, -2, 0, 2, -1, 0, 1],
  sobelY: [-1, -2, -1, 0, 0, 0, 1, 2, 1],
};

export type Convolution3x3Params = {
  kernel: number[];
  mix: number;
  bias: number;
  normalize: boolean;
};

function clamp255(value: number): number {
  if (value <= 0) return 0;
  if (value >= 255) return 255;
  return value;
}

export function resolveConvolutionKernel(preset: ConvolutionPreset, kernel: number[] | null): number[] {
  if (Array.isArray(kernel) && kernel.length === 9 && kernel.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return kernel;
  }

  if (preset === 'custom') {
    return [0, 0, 0, 0, 1, 0, 0, 0, 0];
  }

  return CONVOLUTION_PRESET_KERNELS[preset];
}

export function applyConvolution3x3(
  input: Uint8ClampedArray,
  width: number,
  height: number,
  output: Uint8ClampedArray,
  params: Convolution3x3Params
): void {
  if (width <= 0 || height <= 0) return;
  if (input.length !== width * height * 4) return;
  if (output.length !== width * height * 4) return;
  if (!Array.isArray(params.kernel) || params.kernel.length !== 9) return;

  const mix = Math.max(0, Math.min(1, params.mix));
  const invMix = 1 - mix;
  const bias = Math.max(-1, Math.min(1, params.bias)) * 255;

  const k0 = params.kernel[0] ?? 0;
  const k1 = params.kernel[1] ?? 0;
  const k2 = params.kernel[2] ?? 0;
  const k3 = params.kernel[3] ?? 0;
  const k4 = params.kernel[4] ?? 0;
  const k5 = params.kernel[5] ?? 0;
  const k6 = params.kernel[6] ?? 0;
  const k7 = params.kernel[7] ?? 0;
  const k8 = params.kernel[8] ?? 0;

  const sum = k0 + k1 + k2 + k3 + k4 + k5 + k6 + k7 + k8;
  const normalize = Boolean(params.normalize) && sum !== 0;
  const invSum = normalize ? 1 / sum : 1;

  for (let y = 0; y < height; y += 1) {
    const y0 = y === 0 ? 0 : y - 1;
    const y2 = y === height - 1 ? height - 1 : y + 1;

    const row0 = y0 * width * 4;
    const row1 = y * width * 4;
    const row2 = y2 * width * 4;

    for (let x = 0; x < width; x += 1) {
      const x0 = x === 0 ? 0 : x - 1;
      const x2 = x === width - 1 ? width - 1 : x + 1;

      const i00 = row0 + x0 * 4;
      const i01 = row0 + x * 4;
      const i02 = row0 + x2 * 4;

      const i10 = row1 + x0 * 4;
      const i11 = row1 + x * 4;
      const i12 = row1 + x2 * 4;

      const i20 = row2 + x0 * 4;
      const i21 = row2 + x * 4;
      const i22 = row2 + x2 * 4;

      const r0 = input[i11];
      const g0 = input[i11 + 1];
      const b0 = input[i11 + 2];
      const a0 = input[i11 + 3];

      let r =
        input[i00] * k0 +
        input[i01] * k1 +
        input[i02] * k2 +
        input[i10] * k3 +
        input[i11] * k4 +
        input[i12] * k5 +
        input[i20] * k6 +
        input[i21] * k7 +
        input[i22] * k8;

      let g =
        input[i00 + 1] * k0 +
        input[i01 + 1] * k1 +
        input[i02 + 1] * k2 +
        input[i10 + 1] * k3 +
        input[i11 + 1] * k4 +
        input[i12 + 1] * k5 +
        input[i20 + 1] * k6 +
        input[i21 + 1] * k7 +
        input[i22 + 1] * k8;

      let b =
        input[i00 + 2] * k0 +
        input[i01 + 2] * k1 +
        input[i02 + 2] * k2 +
        input[i10 + 2] * k3 +
        input[i11 + 2] * k4 +
        input[i12 + 2] * k5 +
        input[i20 + 2] * k6 +
        input[i21 + 2] * k7 +
        input[i22 + 2] * k8;

      if (normalize) {
        r *= invSum;
        g *= invSum;
        b *= invSum;
      }

      r += bias;
      g += bias;
      b += bias;

      const outR = mix * clamp255(r) + invMix * r0;
      const outG = mix * clamp255(g) + invMix * g0;
      const outB = mix * clamp255(b) + invMix * b0;

      output[i11] = clamp255(outR);
      output[i11 + 1] = clamp255(outG);
      output[i11 + 2] = clamp255(outB);
      output[i11 + 3] = a0;
    }
  }
}

