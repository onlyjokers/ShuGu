/**
 * Audio split plugin
 * Splits audio into frequency bands and detects beats/BPM
 */

import type { AudioPlugin, AudioSplitFeature, AudioSplitOptions } from './types.js';

export class AudioSplitPlugin implements AudioPlugin {
    readonly id = 'audio-splitter';

    private ctx: AudioContext | null = null;
    private analyser: AnalyserNode | null = null;
    private options: Required<AudioSplitOptions>;
    private running = false;
    private animationId: number | null = null;
    private callbacks: Set<(feature: AudioSplitFeature) => void> = new Set();
    private frequencyData: Uint8Array | null = null;
    private lastFrameTime = 0;

    // Beat detection
    private energyHistory: number[] = [];
    private beatThreshold = 1.3;
    private energyHistorySize = 43; // ~1 second at 43Hz
    private lastBeatTime = 0;
    private beatIntervals: number[] = [];
    private currentBPM: number | null = null;

    constructor(options: AudioSplitOptions = {}) {
        this.options = {
            fftSize: options.fftSize ?? 2048,
            lowCutoff: options.lowCutoff ?? 300,
            highCutoff: options.highCutoff ?? 3000,
            frameRate: options.frameRate ?? 30,
            detectBPM: options.detectBPM ?? true,
        };
    }

    async init(ctx: AudioContext, source: AudioNode, options?: AudioSplitOptions): Promise<void> {
        this.ctx = ctx;

        if (options) {
            this.options = { ...this.options, ...options };
        }

        // Create analyser node
        this.analyser = ctx.createAnalyser();
        this.analyser.fftSize = this.options.fftSize;
        this.analyser.smoothingTimeConstant = 0.2;

        // Connect source to analyser
        source.connect(this.analyser);

        // Initialize frequency data buffer
        this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
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

    onFeature(cb: (feature: AudioSplitFeature) => void): () => void {
        this.callbacks.add(cb);
        return () => this.callbacks.delete(cb);
    }

    configure(options: AudioSplitOptions): void {
        this.options = { ...this.options, ...options };

        if (this.analyser && options.fftSize) {
            this.analyser.fftSize = options.fftSize;
            this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
        }
    }

    destroy(): void {
        this.stop();
        this.callbacks.clear();
        this.analyser?.disconnect();
        this.analyser = null;
        this.ctx = null;
        this.energyHistory = [];
        this.beatIntervals = [];
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
        if (!this.analyser || !this.frequencyData || !this.ctx) return;

        // Get frequency data
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.analyser.getByteFrequencyData(this.frequencyData as any);

        const sampleRate = this.ctx.sampleRate;
        const binCount = this.analyser.frequencyBinCount;
        const binWidth = sampleRate / (binCount * 2);

        // Calculate bin indices for cutoff frequencies
        const lowBinEnd = Math.floor(this.options.lowCutoff / binWidth);
        const highBinStart = Math.floor(this.options.highCutoff / binWidth);

        // Calculate energy in each band
        let lowSum = 0, midSum = 0, highSum = 0, totalSum = 0;
        let lowCount = 0, midCount = 0, highCount = 0;

        for (let i = 0; i < binCount; i++) {
            const value = this.frequencyData[i] / 255;
            totalSum += value * value;

            if (i < lowBinEnd) {
                lowSum += value;
                lowCount++;
            } else if (i >= highBinStart) {
                highSum += value;
                highCount++;
            } else {
                midSum += value;
                midCount++;
            }
        }

        const lowEnergy = lowCount > 0 ? lowSum / lowCount : 0;
        const midEnergy = midCount > 0 ? midSum / midCount : 0;
        const highEnergy = highCount > 0 ? highSum / highCount : 0;
        const rms = Math.sqrt(totalSum / binCount);

        // Beat detection based on low frequency energy
        let beatDetected = false;
        if (this.options.detectBPM) {
            beatDetected = this.detectBeat(lowEnergy);
        }

        // Emit feature
        const feature: AudioSplitFeature = {
            type: 'audio-split',
            lowEnergy,
            midEnergy,
            highEnergy,
            rms,
            bpm: this.currentBPM,
            beatDetected,
            timestamp: Date.now(),
        };

        this.callbacks.forEach(cb => {
            try {
                cb(feature);
            } catch (error) {
                console.error('[AudioSplitPlugin] Callback error:', error);
            }
        });
    }

    private detectBeat(energy: number): boolean {
        // Add to energy history
        this.energyHistory.push(energy);
        if (this.energyHistory.length > this.energyHistorySize) {
            this.energyHistory.shift();
        }

        // Need enough history
        if (this.energyHistory.length < this.energyHistorySize) {
            return false;
        }

        // Calculate average and variance
        const avg = this.energyHistory.reduce((a, b) => a + b, 0) / this.energyHistory.length;
        const variance = this.energyHistory.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / this.energyHistory.length;
        const std = Math.sqrt(variance);

        // Dynamic threshold
        const threshold = avg + this.beatThreshold * std;

        const now = performance.now();
        const minBeatInterval = 250; // Max 240 BPM

        // Detect beat
        if (energy > threshold && now - this.lastBeatTime > minBeatInterval) {
            const interval = now - this.lastBeatTime;
            this.lastBeatTime = now;

            // Track beat intervals for BPM calculation
            if (interval > 0 && interval < 2000) { // Between 30 and 240 BPM
                this.beatIntervals.push(interval);
                if (this.beatIntervals.length > 8) {
                    this.beatIntervals.shift();
                }

                // Calculate BPM from intervals
                if (this.beatIntervals.length >= 3) {
                    const avgInterval = this.beatIntervals.reduce((a, b) => a + b, 0) / this.beatIntervals.length;
                    this.currentBPM = Math.round(60000 / avgInterval);

                    // Clamp to reasonable range
                    if (this.currentBPM < 60) this.currentBPM *= 2;
                    if (this.currentBPM > 180) this.currentBPM = Math.round(this.currentBPM / 2);
                }

                return true;
            }
        }

        return false;
    }
}
