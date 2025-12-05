/**
 * Mel Spectrogram Scene - Visualizes mel frequency bands as bars
 */

import * as THREE from 'three';
import type { VisualScene, VisualContext } from './types.js';

export interface MelSceneOptions {
    /** Number of bars to display */
    barCount?: number;
    /** Bar color gradient start */
    colorStart?: number;
    /** Bar color gradient end */
    colorEnd?: number;
    /** Background color */
    backgroundColor?: number;
    /** Bar spacing */
    barSpacing?: number;
    /** Max bar height */
    maxHeight?: number;
}

export class MelSpectrogramScene implements VisualScene {
    readonly id = 'mel-scene';

    private container: HTMLElement | null = null;
    private scene: THREE.Scene | null = null;
    private camera: THREE.OrthographicCamera | null = null;
    private renderer: THREE.WebGLRenderer | null = null;
    private bars: THREE.Mesh[] = [];
    private options: Required<MelSceneOptions>;
    private targetHeights: number[] = [];

    constructor(options: MelSceneOptions = {}) {
        this.options = {
            barCount: options.barCount ?? 26,
            colorStart: options.colorStart ?? 0x00ff88,
            colorEnd: options.colorEnd ?? 0xff0088,
            backgroundColor: options.backgroundColor ?? 0x0a0a0f,
            barSpacing: options.barSpacing ?? 0.1,
            maxHeight: options.maxHeight ?? 3,
        };

        this.targetHeights = new Array(this.options.barCount).fill(0.1);
    }

    mount(container: HTMLElement): void {
        this.container = container;

        // Create scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(this.options.backgroundColor);

        // Create orthographic camera for 2D look
        const aspect = container.clientWidth / container.clientHeight;
        const frustumSize = 5;
        this.camera = new THREE.OrthographicCamera(
            -frustumSize * aspect / 2,
            frustumSize * aspect / 2,
            frustumSize / 2,
            -frustumSize / 2,
            -10,
            10
        );
        this.camera.position.z = 5;

        // Create renderer
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            powerPreference: 'high-performance',
        });
        this.renderer.setSize(container.clientWidth, container.clientHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        container.appendChild(this.renderer.domElement);

        // Create bars
        this.createBars();

        // Handle resize
        window.addEventListener('resize', this.handleResize);
    }

    unmount(): void {
        window.removeEventListener('resize', this.handleResize);

        // Clean up bars
        this.bars.forEach(bar => {
            bar.geometry.dispose();
            (bar.material as THREE.MeshBasicMaterial).dispose();
        });
        this.bars = [];

        if (this.renderer && this.container) {
            this.container.removeChild(this.renderer.domElement);
            this.renderer.dispose();
        }

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.container = null;
    }

    update(dt: number, context: VisualContext): void {
        if (!this.scene || !this.camera || !this.renderer) return;

        // Update bar heights from mel bands
        if (context.audioFeatures?.melBands) {
            const melBands = context.audioFeatures.melBands;
            const bandCount = Math.min(melBands.length, this.bars.length);

            for (let i = 0; i < bandCount; i++) {
                // Normalize mel band value (log scale, typically -10 to 0)
                const normalized = Math.max(0, (melBands[i] + 10) / 10);
                this.targetHeights[i] = 0.1 + normalized * this.options.maxHeight;
            }
        } else if (context.audioFeatures?.rms !== undefined) {
            // Fallback: use RMS to animate all bars
            const rms = context.audioFeatures.rms;
            for (let i = 0; i < this.bars.length; i++) {
                const phase = (i / this.bars.length + performance.now() / 2000) * Math.PI * 2;
                this.targetHeights[i] = 0.1 + (Math.sin(phase) * 0.5 + 0.5) * rms * this.options.maxHeight;
            }
        }

        // Smooth interpolation
        const lerpFactor = 1 - Math.pow(0.05, dt);

        for (let i = 0; i < this.bars.length; i++) {
            const bar = this.bars[i];
            const currentHeight = bar.scale.y;
            const targetHeight = this.targetHeights[i];
            const newHeight = currentHeight + (targetHeight - currentHeight) * lerpFactor;

            bar.scale.y = newHeight;
            bar.position.y = -this.options.maxHeight / 2 + newHeight / 2;
        }

        // Render
        this.renderer.render(this.scene, this.camera);
    }

    resize(width: number, height: number): void {
        if (!this.camera || !this.renderer) return;

        const aspect = width / height;
        const frustumSize = 5;

        this.camera.left = -frustumSize * aspect / 2;
        this.camera.right = frustumSize * aspect / 2;
        this.camera.top = frustumSize / 2;
        this.camera.bottom = -frustumSize / 2;
        this.camera.updateProjectionMatrix();

        this.renderer.setSize(width, height);

        // Recreate bars for new aspect ratio
        this.bars.forEach(bar => {
            if (this.scene) this.scene.remove(bar);
            bar.geometry.dispose();
            (bar.material as THREE.MeshBasicMaterial).dispose();
        });
        this.bars = [];
        this.createBars();
    }

    private createBars(): void {
        if (!this.scene || !this.camera) return;

        const count = this.options.barCount;
        const totalWidth = (this.camera.right - this.camera.left) * 0.9;
        const barWidth = (totalWidth - (count - 1) * this.options.barSpacing) / count;
        const startX = this.camera.left + totalWidth * 0.05 + barWidth / 2;

        const colorStart = new THREE.Color(this.options.colorStart);
        const colorEnd = new THREE.Color(this.options.colorEnd);

        for (let i = 0; i < count; i++) {
            const geometry = new THREE.BoxGeometry(barWidth, 1, 0.1);

            // Gradient color
            const t = i / (count - 1);
            const color = new THREE.Color().lerpColors(colorStart, colorEnd, t);

            const material = new THREE.MeshBasicMaterial({ color });
            const bar = new THREE.Mesh(geometry, material);

            bar.position.x = startX + i * (barWidth + this.options.barSpacing);
            bar.position.y = -this.options.maxHeight / 2 + 0.1 / 2;
            bar.scale.y = 0.1;

            this.scene.add(bar);
            this.bars.push(bar);
        }
    }

    private handleResize = (): void => {
        if (!this.container) return;
        this.resize(this.container.clientWidth, this.container.clientHeight);
    };
}
