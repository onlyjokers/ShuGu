/**
 * Mel spectrogram plugin
 * Computes mel-frequency spectral features from audio input
 */

import type { AudioPlugin, MelSpectrogramFeature, MelSpectrogramOptions } from './types.js';

export class MelSpectrogramPlugin implements AudioPlugin {
    readonly id = 'mel-spectrogram';

    private ctx: AudioContext | null = null;
    private analyser: AnalyserNode | null = null;
    private options: Required<MelSpectrogramOptions>;
    private running = false;
    private animationId: number | null = null;
    private callbacks: Set<(feature: MelSpectrogramFeature) => void> = new Set();
    private frequencyData: Float32Array | null = null;
    private melFilterbank: number[][] | null = null;
    private lastFrameTime = 0;

    constructor(options: MelSpectrogramOptions = {}) {
        this.options = {
            fftSize: options.fftSize ?? 2048,
            melBands: options.melBands ?? 26,
            minFreq: options.minFreq ?? 20,
            maxFreq: options.maxFreq ?? 20000,
            frameRate: options.frameRate ?? 30,
        };
    }

    async init(ctx: AudioContext, source: AudioNode, options?: MelSpectrogramOptions): Promise<void> {
        this.ctx = ctx;

        if (options) {
            this.options = { ...this.options, ...options };
        }

        // Create analyser node
        this.analyser = ctx.createAnalyser();
        this.analyser.fftSize = this.options.fftSize;
        this.analyser.smoothingTimeConstant = 0.3;

        // Connect source to analyser
        source.connect(this.analyser);

        // Initialize frequency data buffer
        this.frequencyData = new Float32Array(this.analyser.frequencyBinCount);

        // Create mel filterbank
        this.melFilterbank = this.createMelFilterbank(
            ctx.sampleRate,
            this.analyser.frequencyBinCount,
            this.options.melBands,
            this.options.minFreq,
            this.options.maxFreq
        );
    }

    start(): void {
        if (this.running) return;
        this.running = true;
        this.lastFrameTime = performance.now();
        this.processFrame();
    }

    stop(): void {
        this.running = false;
        if (this.animationId !== null) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    onFeature(cb: (feature: MelSpectrogramFeature) => void): () => void {
        this.callbacks.add(cb);
        return () => this.callbacks.delete(cb);
    }

    configure(options: MelSpectrogramOptions): void {
        this.options = { ...this.options, ...options };

        if (this.analyser && options.fftSize) {
            this.analyser.fftSize = options.fftSize;
            this.frequencyData = new Float32Array(this.analyser.frequencyBinCount);
            if (this.ctx) {
                this.melFilterbank = this.createMelFilterbank(
                    this.ctx.sampleRate,
                    this.analyser.frequencyBinCount,
                    this.options.melBands,
                    this.options.minFreq,
                    this.options.maxFreq
                );
            }
        }
    }

    destroy(): void {
        this.stop();
        this.callbacks.clear();
        this.analyser?.disconnect();
        this.analyser = null;
        this.ctx = null;
    }

    private processFrame = (): void => {
        if (!this.running) return;

        const now = performance.now();
        const frameInterval = 1000 / this.options.frameRate;

        if (now - this.lastFrameTime >= frameInterval) {
            this.lastFrameTime = now;
            this.analyze();
        }

        this.animationId = requestAnimationFrame(this.processFrame);
    };

    private analyze(): void {
        if (!this.analyser || !this.frequencyData || !this.melFilterbank) return;

        // Get frequency data in dB
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.analyser.getFloatFrequencyData(this.frequencyData as any);

        // Convert to linear power
        const powerSpectrum = new Float32Array(this.frequencyData.length);
        for (let i = 0; i < this.frequencyData.length; i++) {
            // Convert dB to linear power
            powerSpectrum[i] = Math.pow(10, this.frequencyData[i] / 10);
        }

        // Apply mel filterbank
        const melBands = new Array(this.options.melBands).fill(0);
        for (let m = 0; m < this.options.melBands; m++) {
            for (let k = 0; k < powerSpectrum.length; k++) {
                melBands[m] += powerSpectrum[k] * this.melFilterbank[m][k];
            }
            // Log compression
            melBands[m] = Math.log10(melBands[m] + 1e-10);
        }

        // Calculate RMS
        let sumSquares = 0;
        for (let i = 0; i < powerSpectrum.length; i++) {
            sumSquares += powerSpectrum[i];
        }
        const rms = Math.sqrt(sumSquares / powerSpectrum.length);

        // Calculate spectral centroid
        let weightedSum = 0;
        let totalPower = 0;
        const binWidth = (this.ctx?.sampleRate ?? 44100) / (this.analyser.fftSize);
        for (let i = 0; i < powerSpectrum.length; i++) {
            const freq = i * binWidth;
            weightedSum += freq * powerSpectrum[i];
            totalPower += powerSpectrum[i];
        }
        const spectralCentroid = totalPower > 0 ? weightedSum / totalPower : 0;

        // Emit feature
        const feature: MelSpectrogramFeature = {
            type: 'mel-spectrogram',
            melBands,
            rms,
            spectralCentroid,
            timestamp: Date.now(),
        };

        this.callbacks.forEach(cb => {
            try {
                cb(feature);
            } catch (error) {
                console.error('[MelSpectrogramPlugin] Callback error:', error);
            }
        });
    }

    /**
     * Create mel filterbank matrix
     */
    private createMelFilterbank(
        sampleRate: number,
        numBins: number,
        numMelBands: number,
        minFreq: number,
        maxFreq: number
    ): number[][] {
        // Convert Hz to Mel
        const hzToMel = (hz: number) => 2595 * Math.log10(1 + hz / 700);
        const melToHz = (mel: number) => 700 * (Math.pow(10, mel / 2595) - 1);

        const minMel = hzToMel(minFreq);
        const maxMel = hzToMel(maxFreq);

        // Create mel points
        const melPoints = new Array(numMelBands + 2);
        for (let i = 0; i < melPoints.length; i++) {
            melPoints[i] = minMel + (i / (numMelBands + 1)) * (maxMel - minMel);
        }

        // Convert back to Hz
        const hzPoints = melPoints.map(melToHz);

        // Convert to FFT bins
        const binPoints = hzPoints.map(hz => Math.floor((numBins * 2 + 1) * hz / sampleRate));

        // Create filterbank
        const filterbank: number[][] = [];
        for (let m = 0; m < numMelBands; m++) {
            const filter = new Array(numBins).fill(0);

            for (let k = binPoints[m]; k < binPoints[m + 1]; k++) {
                if (k >= 0 && k < numBins) {
                    filter[k] = (k - binPoints[m]) / (binPoints[m + 1] - binPoints[m]);
                }
            }

            for (let k = binPoints[m + 1]; k < binPoints[m + 2]; k++) {
                if (k >= 0 && k < numBins) {
                    filter[k] = (binPoints[m + 2] - k) / (binPoints[m + 2] - binPoints[m + 1]);
                }
            }

            filterbank.push(filter);
        }

        return filterbank;
    }
}
