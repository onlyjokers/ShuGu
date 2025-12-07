/**
 * ASCII Art Scene
 * Converts audio-driven mel bands into a stylized, colored ASCII mosaic.
 * - Bright peaks become solid color tiles (no glyphs).
 * - Near-black regions stay transparent/black to let the background show through.
 * - A subtle ASCII frame is always drawn to keep edges crisp.
 */
import type { VisualScene, VisualContext } from './types.js';

export interface AsciiSceneOptions {
    /** Pixel size of a single character cell (before devicePixelRatio scaling). */
    cellSize?: number;
    /** Target render frame rate. */
    frameRate?: number;
    /** Log-power floor for normalization (mel bands are log10 power). */
    minDb?: number;
    /** Log-power ceiling for normalization. */
    maxDb?: number;
    /** Background fill color. */
    backgroundColor?: string;
    /** Exponential smoothing applied to incoming bands. */
    smoothing?: number;
    /** Whether to always render an ASCII border. */
    showBorder?: boolean;
}

type RGB = [number, number, number];

export class AsciiArtScene implements VisualScene {
    readonly id = 'ascii-scene';

    private container: HTMLElement | null = null;
    private canvas: HTMLCanvasElement | null = null;
    private ctx: CanvasRenderingContext2D | null = null;
    private width = 0;
    private height = 0;
    private cols = 0;
    private rows = 0;
    private cellW = 0;
    private cellH = 0;
    private grid: number[][] = [];
    private accumulator = 0;
    private options: Required<AsciiSceneOptions>;
    private palette: RGB[];
    private resizeObserver: ResizeObserver | null = null;
    private seed = Math.floor(Math.random() * 1_000_000);
    private tintShift = 0;
    private lastRms = 0;

    // Glyph ramps for varying density and direction
    private readonly baseRamp = ['.', '`', ',', ':', ';', '-', '~', '+', '*', 'x', 'o', 'O', '%', '#', '@'];
    private readonly strokeRamp = ['/', '\\', '|', '-', '='];

    constructor(options: AsciiSceneOptions = {}) {
        this.options = {
            cellSize: options.cellSize ?? 11,
            frameRate: options.frameRate ?? 24,
            minDb: options.minDb ?? -9,
            maxDb: options.maxDb ?? 0.5,
            backgroundColor: options.backgroundColor ?? '#05040a',
            smoothing: options.smoothing ?? 0.72,
            showBorder: options.showBorder ?? true,
        };

        this.palette = this.buildPalette();
    }

    mount(container: HTMLElement): void {
        this.container = container;

        this.canvas = document.createElement('canvas');
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.canvas.style.display = 'block';

        const ctx = this.canvas.getContext('2d');
        if (!ctx) return;
        this.ctx = ctx;
        this.ctx.imageSmoothingEnabled = false;

        this.setSize(container.clientWidth, container.clientHeight);
        this.resetGrid();
        this.fillBackground();

        container.appendChild(this.canvas);

        this.resizeObserver = new ResizeObserver(entries => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                this.setSize(Math.floor(width), Math.floor(height));
                this.resetGrid();
                this.fillBackground();
            }
        });
        this.resizeObserver.observe(container);
    }

    unmount(): void {
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;

        if (this.container && this.canvas) {
            this.container.removeChild(this.canvas);
        }

        this.canvas = null;
        this.ctx = null;
        this.grid = [];
        this.accumulator = 0;
    }

    update(dt: number, context: VisualContext): void {
        if (!this.ctx) return;

        this.accumulator += dt;
        const minInterval = 1 / this.options.frameRate;
        if (this.accumulator < minInterval) return;
        this.accumulator = 0;

        const bands = context.audioFeatures?.melBands;
        const centroid = context.audioFeatures?.spectralCentroid ?? 0;
        this.lastRms = context.audioFeatures?.rms ?? this.lastRms * 0.96;

        if (bands && bands.length) {
            this.ingestBands(bands);
            this.tintShift = this.computeTintShift(centroid, this.lastRms);
        } else {
            this.fadeSilence();
        }

        this.draw();
    }

    resize(width: number, height: number): void {
        this.setSize(width, height);
        this.resetGrid();
        this.fillBackground();
    }

    private setSize(width: number, height: number): void {
        if (!this.canvas || !this.ctx) return;
        const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));

        this.width = Math.max(1, Math.floor(width));
        this.height = Math.max(1, Math.floor(height));
        this.canvas.width = Math.floor(this.width * dpr);
        this.canvas.height = Math.floor(this.height * dpr);
        this.canvas.style.width = `${this.width}px`;
        this.canvas.style.height = `${this.height}px`;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        this.cols = Math.max(24, Math.floor(this.width / this.options.cellSize));
        this.rows = Math.max(18, Math.floor(this.height / (this.options.cellSize * 1.05)));
        this.cellW = this.width / this.cols;
        this.cellH = this.height / this.rows;
    }

    private resetGrid(): void {
        this.grid = Array.from({ length: this.rows }, () => new Array(this.cols).fill(0));
    }

    private fillBackground(): void {
        if (!this.ctx) return;
        this.ctx.fillStyle = this.options.backgroundColor;
        this.ctx.fillRect(0, 0, this.width, this.height);
    }

    /** Shift the field, inject latest mel column on the left. */
    private ingestBands(bands: number[]): void {
        if (!this.grid.length) return;

        // Scroll existing columns to the right
        for (let r = 0; r < this.rows; r++) {
            const row = this.grid[r];
            for (let c = this.cols - 1; c > 0; c--) {
                row[c] = row[c - 1] * 0.985; // slight decay while shifting
            }
        }

        // Inject new column at x = 0
        const bandCount = bands.length;
        for (let r = 0; r < this.rows; r++) {
            const t = 1 - r / (this.rows - 1 || 1);
            const bandPos = t * (bandCount - 1);
            const i0 = Math.floor(bandPos);
            const i1 = Math.min(bandCount - 1, i0 + 1);
            const frac = bandPos - i0;
            const value = bands[i0] * (1 - frac) + bands[i1] * frac;
            const normalized = this.normalize(value);
            const previous = this.grid[r][0] ?? 0;
            this.grid[r][0] = previous * this.options.smoothing + normalized * (1 - this.options.smoothing);
        }
    }

    private fadeSilence(): void {
        if (!this.grid.length) return;
        for (let r = 0; r < this.rows; r++) {
            const row = this.grid[r];
            for (let c = 0; c < this.cols; c++) {
                row[c] *= 0.985;
            }
        }
    }

    private draw(): void {
        if (!this.ctx) return;

        const ctx = this.ctx;
        ctx.fillStyle = this.options.backgroundColor;
        ctx.fillRect(0, 0, this.width, this.height);

        const fontSize = Math.max(9, Math.round(this.cellH * 0.9));
        ctx.font = `${fontSize}px "IBM Plex Mono", "SFMono-Regular", "Menlo", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'transparent';

        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                const v = this.grid[r][c];
                if (v < 0.08) continue; // pure black stays empty

                const clamped = Math.min(1, Math.max(0, v));
                const [rCol, gCol, bCol] = this.sampleColor(clamped);
                const x = c * this.cellW;
                const y = r * this.cellH;

                // Brightest parts: solid color tiles
                if (clamped >= 0.82) {
                    ctx.fillStyle = `rgba(${rCol}, ${gCol}, ${bCol}, ${0.94})`;
                    ctx.fillRect(x, y, this.cellW + 0.75, this.cellH + 0.75);
                    continue;
                }

                // Mid / low: ASCII glyphs
                const glyph = this.pickGlyph(clamped, c, r);
                const alpha = 0.35 + clamped * 0.55 + this.lastRms * 0.15;
                ctx.fillStyle = `rgba(${rCol}, ${gCol}, ${bCol}, ${Math.min(1, alpha)})`;
                ctx.fillText(glyph, x + this.cellW / 2, y + this.cellH / 2 + this.cellH * 0.05);
            }
        }

        if (this.options.showBorder) {
            this.drawBorder(ctx);
        }
    }

    /** Pick a glyph with slight directional variation for richer texture. */
    private pickGlyph(intensity: number, col: number, row: number): string {
        const h = this.hash(col, row + this.seed);

        if (intensity > 0.62) {
            const stroke = this.strokeRamp[Math.floor(h * this.strokeRamp.length) % this.strokeRamp.length];
            return stroke;
        }

        const idx = Math.min(this.baseRamp.length - 1, Math.floor(intensity * this.baseRamp.length));
        return this.baseRamp[idx];
    }

    /** ASCII frame along the edges for crisp boundaries. */
    private drawBorder(ctx: CanvasRenderingContext2D): void {
        const edgeColor = `rgba(255, 228, 210, 0.55)`;
        ctx.fillStyle = edgeColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `${Math.max(10, Math.round(this.cellH * 0.95))}px "IBM Plex Mono", "SFMono-Regular", "Menlo", monospace`;

        const topChars = ['=', '-', '='];
        const sideChars = ['|', '!', '|'];

        // Top & bottom borders
        for (let c = 0; c < this.cols; c++) {
            const ch = topChars[c % topChars.length];
            const x = c * this.cellW + this.cellW / 2;
            ctx.fillText(ch, x, this.cellH * 0.55);
            ctx.fillText(ch, x, this.height - this.cellH * 0.45);
        }

        // Left & right borders
        for (let r = 0; r < this.rows; r++) {
            const ch = sideChars[r % sideChars.length];
            const y = r * this.cellH + this.cellH / 2;
            ctx.fillText(ch, this.cellW * 0.45, y);
            ctx.fillText(ch, this.width - this.cellW * 0.45, y);
        }

        // Corners
        ctx.fillText('+', this.cellW * 0.45, this.cellH * 0.55);
        ctx.fillText('+', this.width - this.cellW * 0.45, this.cellH * 0.55);
        ctx.fillText('+', this.cellW * 0.45, this.height - this.cellH * 0.45);
        ctx.fillText('+', this.width - this.cellW * 0.45, this.height - this.cellH * 0.45);
    }

    private normalize(value: number): number {
        const { minDb, maxDb } = this.options;
        const clamped = Math.min(maxDb, Math.max(minDb, value));
        return (clamped - minDb) / (maxDb - minDb);
    }

    private sampleColor(t: number): RGB {
        const scaled = Math.min(1, Math.max(0, t + this.tintShift * 0.25));
        const pos = scaled * (this.palette.length - 1);
        const i0 = Math.floor(pos);
        const i1 = Math.min(this.palette.length - 1, i0 + 1);
        const frac = pos - i0;

        const c0 = this.palette[i0];
        const c1 = this.palette[i1];

        return [
            Math.round(c0[0] + (c1[0] - c0[0]) * frac),
            Math.round(c0[1] + (c1[1] - c0[1]) * frac),
            Math.round(c0[2] + (c1[2] - c0[2]) * frac),
        ];
    }

    private computeTintShift(spectralCentroid: number, rms: number): number {
        // Map centroid (Hz) into a small hue shift window; bias with RMS for vividness.
        const normCentroid = Math.min(1, spectralCentroid / 8000);
        return (normCentroid - 0.5) * 0.4 + rms * 0.18;
    }

    private buildPalette(): RGB[] {
        // Deep plum -> magenta -> ember -> warm gold
        return [
            [10, 6, 18],
            [32, 10, 44],
            [68, 24, 82],
            [111, 42, 102],
            [158, 64, 103],
            [196, 96, 92],
            [228, 140, 96],
            [245, 184, 122],
            [252, 214, 160],
        ];
    }

    private hash(x: number, y: number): number {
        let n = x * 374761393 + y * 668265263 + this.seed * 374761393;
        n = (n ^ (n >> 13)) * 1274126177;
        n ^= n >> 16;
        return (n >>> 0) / 0xffffffff;
    }
}
