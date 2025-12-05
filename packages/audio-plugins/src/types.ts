/**
 * Audio plugin interface
 */
export interface AudioPlugin {
    /** Unique plugin identifier */
    id: string;

    /**
     * Initialize the plugin with audio context and source
     */
    init(ctx: AudioContext, source: AudioNode, options?: Record<string, unknown>): Promise<void>;

    /**
     * Start processing
     */
    start(): void;

    /**
     * Stop processing
     */
    stop(): void;

    /**
     * Subscribe to feature output
     */
    onFeature(cb: (feature: AudioFeature) => void): () => void;

    /**
     * Configure plugin options
     */
    configure?(options: Record<string, unknown>): void;

    /**
     * Destroy and clean up resources
     */
    destroy?(): void;
}

/**
 * Audio feature output types
 */
export interface MelSpectrogramFeature {
    type: 'mel-spectrogram';
    /** Mel band energies */
    melBands: number[];
    /** Overall volume/RMS */
    rms: number;
    /** Spectral centroid */
    spectralCentroid: number;
    /** Timestamp */
    timestamp: number;
}

export interface AudioSplitFeature {
    type: 'audio-split';
    /** Low frequency energy (bass) */
    lowEnergy: number;
    /** Mid frequency energy */
    midEnergy: number;
    /** High frequency energy (treble) */
    highEnergy: number;
    /** Estimated BPM */
    bpm: number | null;
    /** Overall RMS volume */
    rms: number;
    /** Beat detected in this frame */
    beatDetected: boolean;
    /** Timestamp */
    timestamp: number;
}

export type AudioFeature = MelSpectrogramFeature | AudioSplitFeature;

/**
 * Plugin configuration types
 */
export interface MelSpectrogramOptions {
    /** FFT size (default: 2048) */
    fftSize?: number;
    /** Number of mel bands (default: 26) */
    melBands?: number;
    /** Minimum frequency (default: 20) */
    minFreq?: number;
    /** Maximum frequency (default: 20000) */
    maxFreq?: number;
    /** Analysis frame rate in Hz (default: 30) */
    frameRate?: number;
}

export interface AudioSplitOptions {
    /** FFT size (default: 2048) */
    fftSize?: number;
    /** Low frequency cutoff (default: 300) */
    lowCutoff?: number;
    /** High frequency cutoff (default: 3000) */
    highCutoff?: number;
    /** Analysis frame rate in Hz (default: 30) */
    frameRate?: number;
    /** Enable BPM detection (default: true) */
    detectBPM?: boolean;
}
