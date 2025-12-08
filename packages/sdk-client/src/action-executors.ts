/**
 * Action executors for client-side functionality
 * Handles flashlight, vibration, screen effects, sound playback
 */

import type {
    FlashlightPayload,
    ScreenColorPayload,
    VibratePayload,
    PlaySoundPayload,
    ModulateSoundPayload,
} from '@shugu/protocol';

/**
 * Flashlight controller using MediaStream torch capability
 */
export class FlashlightController {
    private stream: MediaStream | null = null;
    private track: MediaStreamTrack | null = null;
    private blinkIntervalId: ReturnType<typeof setInterval> | null = null;
    private isOn = false;
    private fallbackElement: HTMLElement | null = null;

    /**
     * Check if torch is supported
     */
    async isSupported(): Promise<boolean> {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment' },
            });
            const track = stream.getVideoTracks()[0];
            const capabilities = track.getCapabilities() as any;
            stream.getTracks().forEach(t => t.stop());
            return 'torch' in capabilities;
        } catch {
            return false;
        }
    }

    /**
     * Initialize the flashlight (request camera access)
     */
    async init(): Promise<boolean> {
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment' },
            });
            this.track = this.stream.getVideoTracks()[0];
            return true;
        } catch (error) {
            console.warn('[Flashlight] Failed to initialize:', error);
            return false;
        }
    }

    /**
     * Set flashlight mode
     */
    async setMode(payload: FlashlightPayload): Promise<void> {
        this.stopBlink();

        switch (payload.mode) {
            case 'off':
                await this.setTorch(false);
                this.hideFallback();
                break;
            case 'on':
                const success = await this.setTorch(true);
                if (!success) this.showFallback();
                break;
            case 'blink':
                this.startBlink(payload.frequency ?? 2, payload.dutyCycle ?? 0.5);
                break;
        }
    }

    /**
     * Clean up resources
     */
    destroy(): void {
        this.stopBlink();
        this.hideFallback();
        if (this.stream) {
            this.stream.getTracks().forEach(t => t.stop());
            this.stream = null;
            this.track = null;
        }
    }

    private async setTorch(on: boolean): Promise<boolean> {
        if (!this.track) {
            // Try to initialize
            const success = await this.init();
            if (!success) return false;
        }

        try {
            await this.track!.applyConstraints({
                advanced: [{ torch: on } as any],
            });
            this.isOn = on;
            return true;
        } catch {
            return false;
        }
    }

    private startBlink(frequency: number, dutyCycle: number): void {
        const period = 1000 / frequency;
        const onTime = period * dutyCycle;

        const doBlink = async () => {
            const success = await this.setTorch(true);
            if (!success) this.showFallback();

            setTimeout(async () => {
                await this.setTorch(false);
                this.hideFallback();
            }, onTime);
        };

        doBlink();
        this.blinkIntervalId = setInterval(doBlink, period);
    }

    private stopBlink(): void {
        if (this.blinkIntervalId) {
            clearInterval(this.blinkIntervalId);
            this.blinkIntervalId = null;
        }
    }

    private showFallback(): void {
        if (!this.fallbackElement) {
            this.fallbackElement = document.createElement('div');
            this.fallbackElement.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: white;
        z-index: 99999;
        pointer-events: none;
      `;
            document.body.appendChild(this.fallbackElement);
        }
        this.fallbackElement.style.display = 'block';
    }

    private hideFallback(): void {
        if (this.fallbackElement) {
            this.fallbackElement.style.display = 'none';
        }
    }
}

/**
 * Screen color and brightness control
 */
export class ScreenController {
    private overlayElement: HTMLElement | null = null;
    private animationFrame: number | null = null;
    private animationInterval: ReturnType<typeof setInterval> | null = null;
    private animationStart = 0;

    /**
     * Set screen color overlay
     */
    setColor(payload: ScreenColorPayload): void {
        this.ensureOverlay();
        this.stopAnimation();

        const mode = payload.mode ?? 'solid';

        switch (mode) {
            case 'blink':
                this.startBlink(payload);
                break;
            case 'pulse':
                this.startPulse(payload);
                break;
            case 'modulate':
                this.startModulate(payload);
                break;
            case 'cycle':
                this.startCycle(payload);
                break;
            default:
                this.applySolid(payload.color, payload.opacity ?? 1);
        }
    }

    /**
     * Set screen brightness (via overlay)
     */
    setBrightness(brightness: number): void {
        // brightness 0-1, where 0 is darkest (black overlay), 1 is normal
        this.ensureOverlay();
        const darkness = 1 - Math.max(0, Math.min(1, brightness));
        this.overlayElement!.style.backgroundColor = 'black';
        this.overlayElement!.style.opacity = String(darkness);
        this.overlayElement!.style.display = darkness > 0 ? 'block' : 'none';
    }

    /**
     * Clear screen effects
     */
    clear(): void {
        if (this.overlayElement) {
            this.overlayElement.style.display = 'none';
        }
    }

    /**
     * Clean up
     */
    destroy(): void {
        if (this.overlayElement) {
            this.overlayElement.remove();
            this.overlayElement = null;
        }
        this.stopAnimation();
    }

    private ensureOverlay(): void {
        if (!this.overlayElement) {
            this.overlayElement = document.createElement('div');
            this.overlayElement.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 99998;
        pointer-events: none;
        transition: background-color 0.1s, opacity 0.1s;
      `;
            document.body.appendChild(this.overlayElement);
        }
    }

    private applySolid(color: string, opacity: number): void {
        this.overlayElement!.style.backgroundImage = '';
        this.overlayElement!.style.backgroundColor = color;
        this.overlayElement!.style.opacity = String(opacity);
        this.overlayElement!.style.display = 'block';
    }

    private stopAnimation(): void {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
        if (this.animationInterval) {
            clearInterval(this.animationInterval);
            this.animationInterval = null;
        }
        this.animationStart = 0;
    }

    private startBlink(payload: ScreenColorPayload): void {
        this.animationStart = 0;
        const frequency = Math.max(0.2, payload.blinkFrequency ?? 2); // Hz
        const period = 1000 / frequency;
        const onTime = period * 0.5;

        const tick = () => {
            this.applySolid(payload.color, payload.opacity ?? 1);
            setTimeout(() => {
                this.overlayElement!.style.display = 'none';
            }, onTime);
        };

        tick();
        this.animationInterval = setInterval(tick, period);
    }

    private startPulse(payload: ScreenColorPayload): void {
        this.animationStart = 0;
        const duration = Math.max(300, payload.pulseDuration ?? 1200);
        const frequencyHz = 1000 / duration;
        this.startModulate({
            ...payload,
            mode: 'modulate',
            frequencyHz,
            waveform: payload.waveform ?? 'sine',
            minOpacity: payload.pulseMin ?? payload.minOpacity ?? 0.25,
            maxOpacity: payload.opacity ?? payload.maxOpacity ?? 1,
        });
    }

    private startCycle(payload: ScreenColorPayload): void {
        this.animationStart = 0;
        const colors = payload.cycleColors && payload.cycleColors.length >= 2
            ? payload.cycleColors
            : [payload.color, payload.color];
        const duration = Math.max(600, payload.cycleDuration ?? 4000);
        const maxOpacity = Math.min(1, payload.opacity ?? 1);

        const loop = (timestamp: number) => {
            if (!this.animationStart) this.animationStart = timestamp;
            const elapsed = (timestamp - this.animationStart) % duration;
            const segment = duration / colors.length;
            const index = Math.floor(elapsed / segment);
            const nextIndex = (index + 1) % colors.length;
            const localT = (elapsed % segment) / segment;

            const mixed = this.mixColors(colors[index], colors[nextIndex], localT);
            this.applySolid(mixed, maxOpacity);

            this.animationFrame = requestAnimationFrame(loop);
        };

        this.animationFrame = requestAnimationFrame(loop);
    }

    private mixColors(a: string, b: string, t: number): string {
        const ca = this.parseColor(a);
        const cb = this.parseColor(b);
        if (!ca || !cb) return t < 0.5 ? a : b;

        const r = Math.round(ca.r + (cb.r - ca.r) * t);
        const g = Math.round(ca.g + (cb.g - ca.g) * t);
        const bl = Math.round(ca.b + (cb.b - ca.b) * t);
        return `rgb(${r}, ${g}, ${bl})`;
    }

    private parseColor(color: string): { r: number; g: number; b: number } | null {
        // Supports #rgb, #rrggbb, rgb()
        if (color.startsWith('#')) {
            const hex = color.slice(1);
            if (hex.length === 3) {
                const r = parseInt(hex[0] + hex[0], 16);
                const g = parseInt(hex[1] + hex[1], 16);
                const b = parseInt(hex[2] + hex[2], 16);
                return { r, g, b };
            }
            if (hex.length === 6) {
                const r = parseInt(hex.slice(0, 2), 16);
                const g = parseInt(hex.slice(2, 4), 16);
                const b = parseInt(hex.slice(4, 6), 16);
                return { r, g, b };
            }
        }

        const match = color.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
        if (match) {
            return {
                r: parseInt(match[1], 10),
                g: parseInt(match[2], 10),
                b: parseInt(match[3], 10),
            };
        }

        return null;
    }

    private startModulate(payload: ScreenColorPayload): void {
        this.animationStart = 0;
        const freq = Math.max(0.1, payload.frequencyHz ?? 1);
        const minOpacity = this.clamp(payload.minOpacity ?? payload.pulseMin ?? 0, 0, 1);
        const maxOpacity = this.clamp(payload.maxOpacity ?? payload.opacity ?? 1, minOpacity, 1);
        const primaryColor = payload.color;
        const secondaryColor = payload.secondaryColor ?? payload.color;
        const waveform = payload.waveform ?? 'sine';

        const loop = (timestamp: number) => {
            if (!this.animationStart) this.animationStart = timestamp;
            const elapsedMs = timestamp - this.animationStart;
            const phase = (elapsedMs / 1000) * freq * Math.PI * 2;
            const factor = this.waveformValue(waveform, phase); // 0..1
            const opacity = minOpacity + (maxOpacity - minOpacity) * factor;
            const mixed = this.mixColors(primaryColor, secondaryColor, factor);
            this.applySolid(mixed, opacity);
            this.animationFrame = requestAnimationFrame(loop);
        };

        this.animationFrame = requestAnimationFrame(loop);
    }

    private waveformValue(type: NonNullable<ScreenColorPayload['waveform']>, phase: number): number {
        const norm = (v: number) => (v + 1) / 2; // map -1..1 to 0..1
        switch (type) {
            case 'square':
                return phase % (2 * Math.PI) < Math.PI ? 1 : 0;
            case 'triangle': {
                const t = phase % (2 * Math.PI);
                return t < Math.PI
                    ? t / Math.PI
                    : 1 - (t - Math.PI) / Math.PI;
            }
            case 'sawtooth':
                return (phase % (2 * Math.PI)) / (2 * Math.PI);
            case 'sine':
            default:
                return norm(Math.sin(phase));
        }
    }

    private clamp(v: number, min: number, max: number): number {
        return Math.min(max, Math.max(min, v));
    }
}

/**
 * Vibration controller
 */
export class VibrationController {
    private isSupported: boolean;
    private visualShakeInterval: ReturnType<typeof setInterval> | null = null;

    constructor() {
        this.isSupported = typeof navigator !== 'undefined' && 'vibrate' in navigator;
    }

    /**
     * Check if vibration is supported
     */
    checkSupport(): boolean {
        // Evaluate support based on native API, but we'll fallback to visual
        return true; 
    }

    /**
     * Trigger vibration pattern
     */
    vibrate(payload: VibratePayload): void {
        let pattern = payload.pattern;

        // Handle repeat
        if (payload.repeat && payload.repeat > 1) {
            const originalPattern = [...pattern];
            for (let i = 1; i < payload.repeat; i++) {
                pattern = [...pattern, ...originalPattern];
            }
        }

        if (this.isSupported) {
            try {
                navigator.vibrate(pattern);
            } catch (e) {
                // Some browsers might throw even if 'vibrate' is in navigator
                this.performVisualVibration(pattern);
            }
        } else {
            console.log('[Vibration] Native vibration not supported, using visual fallback');
            this.performVisualVibration(pattern);
        }
    }

    /**
     * Stop vibration
     */
    stop(): void {
        if (this.isSupported) {
            try {
                navigator.vibrate(0);
            } catch (e) {}
        }
        this.stopVisualVibration();
    }

    /**
     * Fallback visual vibration (shakes the screen)
     */
    private performVisualVibration(pattern: number[]): void {
        this.stopVisualVibration();
        
        const body = document.body;
        const initialTransform = body.style.transform;
        const startTime = Date.now();
        
        // Calculate total duration
        const totalDuration = pattern.reduce((a, b) => a + b, 0);
        
        let patternIndex = 0;
        let lastToggleTime = 0;
        let isVibrating = true; // First element is vibration duration

        const shake = () => {
            const elapsed = Date.now() - startTime;
            if (elapsed >= totalDuration) {
                this.stopVisualVibration();
                return;
            }

            // Find current phase based on elapsed time
            let timeSum = 0;
            let currentPhaseIndex = 0;
            for (let i = 0; i < pattern.length; i++) {
                if (elapsed < timeSum + pattern[i]) {
                    currentPhaseIndex = i;
                    break;
                }
                timeSum += pattern[i];
            }

            // Even index = vibrate, Odd index = pause
            const shouldShake = currentPhaseIndex % 2 === 0;

            if (shouldShake) {
                const intensity = 5; // pixels
                const x = (Math.random() - 0.5) * intensity;
                const y = (Math.random() - 0.5) * intensity;
                body.style.transform = `translate(${x}px, ${y}px)`;
            } else {
                body.style.transform = initialTransform;
            }
        };

        this.visualShakeInterval = setInterval(shake, 16); // ~60fps
    }

    private stopVisualVibration(): void {
        if (this.visualShakeInterval) {
            clearInterval(this.visualShakeInterval);
            this.visualShakeInterval = null;
            document.body.style.transform = '';
        }
    }
}

/**
 * Sound player using Web Audio API
 */
export class SoundPlayer {
    private audioContext: AudioContext | null = null;
    private currentSource: AudioBufferSourceNode | null = null;
    private gainNode: GainNode | null = null;
    private audioCache: Map<string, AudioBuffer> = new Map();
    private currentUrl: string | null = null;

    /**
     * Initialize audio context (must be called from user gesture)
     */
    async init(): Promise<void> {
        if (this.audioContext) return;

        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        this.gainNode = this.audioContext.createGain();
        this.gainNode.connect(this.audioContext.destination);
    }

    /**
     * Resume audio context if suspended
     */
    async resume(): Promise<void> {
        if (this.audioContext?.state === 'suspended') {
            await this.audioContext.resume();
        }
    }

    /**
     * Play sound from URL
     */
    async play(payload: PlaySoundPayload, delaySeconds = 0): Promise<void> {
        if (!this.audioContext) {
            await this.init();
        }

        await this.resume();
        this.stop();

        try {
            // Check cache or load
            let buffer = this.audioCache.get(payload.url);
            if (!buffer) {
                const response = await fetch(payload.url);
                const arrayBuffer = await response.arrayBuffer();
                buffer = await this.audioContext!.decodeAudioData(arrayBuffer);
                this.audioCache.set(payload.url, buffer);
            }

            // Create source and play
            this.currentSource = this.audioContext!.createBufferSource();
            this.currentSource.buffer = buffer;
            this.currentSource.loop = payload.loop ?? false;
            this.currentSource.connect(this.gainNode!);

            // Set volume
            this.gainNode!.gain.value = payload.volume ?? 1;

            const now = this.audioContext!.currentTime;
            const startTime = now + delaySeconds;

            // Handle fade in
            if (payload.fadeIn) {
                this.gainNode!.gain.setValueAtTime(0, startTime);
                this.gainNode!.gain.linearRampToValueAtTime(
                    payload.volume ?? 1,
                    startTime + payload.fadeIn / 1000
                );
            }

            this.currentSource.start(startTime);
            this.currentUrl = payload.url;

        } catch (error) {
            console.error('[SoundPlayer] Failed to play:', error);
        }
    }

    /**
     * Stop current playback
     */
    stop(): void {
        if (this.currentSource) {
            try {
                this.currentSource.stop();
            } catch {
                // Already stopped
            }
            this.currentSource.disconnect();
            this.currentSource = null;
            this.currentUrl = null;
        }
    }

    /**
     * Set volume
     */
    setVolume(volume: number): void {
        if (this.gainNode) {
            this.gainNode.gain.value = Math.max(0, Math.min(1, volume));
        }
    }

    /**
     * Get audio context for plugins
     */
    getAudioContext(): AudioContext | null {
        return this.audioContext;
    }

    /**
     * Destroy and clean up
     */
    async destroy(): Promise<void> {
        this.stop();
        this.audioCache.clear();
        if (this.audioContext) {
            await this.audioContext.close();
            this.audioContext = null;
        }
    }
}

/**
 * Synthesized modulation tone player (short beeps/buzz)
 */
export class ModulatedSoundPlayer {
    private audioContext: AudioContext | null = null;
    private gainNode: GainNode | null = null;
    private carrier: OscillatorNode | null = null;
    private lfo: OscillatorNode | null = null;
    private lfoGain: GainNode | null = null;

    async play(payload: ModulateSoundPayload, sharedContext?: AudioContext | null, delaySeconds = 0): Promise<void> {
        await this.ensureContext(sharedContext);
        if (!this.audioContext || !this.gainNode) return;

        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }

        this.stop();

        const ctx = this.audioContext;
        // Use scheduled time instead of strictly 'now'
        const now = ctx.currentTime + delaySeconds;
        
        const durationMs = payload.duration ?? 200;
        const duration = Math.max(0.02, durationMs / 1000);
        
        // ... rest of logic
        const attack = Math.max(0, (payload.attack ?? 10) / 1000);
        const release = Math.max(0, (payload.release ?? 40) / 1000);
        const volume = this.clamp(payload.volume ?? 0.7, 0, 1);
        const freq = payload.frequency ?? 180;
        const waveform = payload.waveform ?? 'square';
        const modDepth = this.clamp(payload.modDepth ?? 0, 0, 1);
        const modFreq = payload.modFrequency ?? 12;

        this.carrier = ctx.createOscillator();
        this.carrier.type = waveform;
        this.carrier.frequency.value = freq;

        // Schedule volume envelope
        this.gainNode.gain.cancelScheduledValues(now);
        this.gainNode.gain.setValueAtTime(0, now);
        this.gainNode.gain.linearRampToValueAtTime(volume, now + attack);
        this.gainNode.gain.setValueAtTime(volume, now + Math.max(attack, duration - release));
        this.gainNode.gain.linearRampToValueAtTime(0.0001, now + duration); 

        if (modDepth > 0) {
            this.lfo = ctx.createOscillator();
            this.lfo.frequency.value = modFreq;
            this.lfoGain = ctx.createGain();
            this.lfoGain.gain.value = modDepth * freq;
            this.lfo.connect(this.lfoGain);
            this.lfoGain.connect(this.carrier.frequency);
        }

        this.carrier.connect(this.gainNode);

        // Schedule start
        this.carrier.start(now);
        this.lfo?.start(now);

        // Schedule stop
        this.carrier.stop(now + duration + release * 2);
        if (this.lfo) {
            this.lfo.stop(now + duration + release * 2);
        }

        // Cleanup when finished (approximately)
        const cleanup = () => this.stop();
        // onended fires when the sound normally stops, which is good
        this.carrier.onended = cleanup;
    }

    stop(): void {
        this.carrier?.disconnect();
        this.carrier?.stop();
        this.carrier = null;

        this.lfoGain?.disconnect();
        this.lfoGain = null;
        this.lfo?.disconnect();
        try {
            this.lfo?.stop();
        } catch {}
        this.lfo = null;

        if (this.gainNode) {
            const now = this.audioContext?.currentTime ?? 0;
            this.gainNode.gain.cancelScheduledValues(now);
            this.gainNode.gain.setValueAtTime(0, now);
        }
    }

    getAudioContext(): AudioContext | null {
        return this.audioContext;
    }

    private async ensureContext(shared?: AudioContext | null): Promise<void> {
        if (this.audioContext && this.gainNode) return;

        if (shared) {
            this.audioContext = shared;
        } else {
            this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        }

        this.gainNode = this.audioContext.createGain();
        this.gainNode.gain.value = 0;
        this.gainNode.connect(this.audioContext.destination);
    }

    private clamp(value: number, min: number, max: number): number {
        return Math.min(max, Math.max(min, value));
    }
}

/**
 * Wake lock to prevent screen from sleeping
 */
export class WakeLockController {
    private wakeLock: WakeLockSentinel | null = null;
    private isSupported: boolean;

    constructor() {
        this.isSupported = 'wakeLock' in navigator;
    }

    /**
     * Check if wake lock is supported
     */
    checkSupport(): boolean {
        return this.isSupported;
    }

    /**
     * Request wake lock
     */
    async request(): Promise<boolean> {
        if (!this.isSupported) {
            console.log('[WakeLock] Not supported on this device');
            return false;
        }

        try {
            if (this.wakeLock) return true; // Already active

            this.wakeLock = await navigator.wakeLock.request('screen');
            console.log('[WakeLock] Acquired');

            // Re-acquire on visibility change
            document.removeEventListener('visibilitychange', this.handleVisibilityChange);
            document.addEventListener('visibilitychange', this.handleVisibilityChange);
            return true;
        } catch (error) {
            console.warn('[WakeLock] Failed to acquire:', error);
            return false;
        }
    }

    /**
     * Release wake lock
     */
    async release(): Promise<void> {
        document.removeEventListener('visibilitychange', this.handleVisibilityChange);
        if (this.wakeLock) {
            await this.wakeLock.release();
            this.wakeLock = null;
            console.log('[WakeLock] Released');
        }
    }

    private handleVisibilityChange = async (): Promise<void> => {
        if (document.visibilityState === 'visible' && this.isSupported) {
            try {
                this.wakeLock = await navigator.wakeLock.request('screen');
            } catch {
                // Ignore errors on re-acquire
            }
        }
    };
}
