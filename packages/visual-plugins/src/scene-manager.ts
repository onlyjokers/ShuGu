/**
 * Scene Manager - Manages visual scene switching and lifecycle
 */

import type { VisualScene, VisualContext, SceneManager } from './types.js';

export class DefaultSceneManager implements SceneManager {
    private scenes: Map<string, VisualScene> = new Map();
    private currentScene: VisualScene | null = null;
    private container: HTMLElement | null = null;

    constructor(container: HTMLElement) {
        this.container = container;
    }

    register(scene: VisualScene): void {
        this.scenes.set(scene.id, scene);
    }

    switchTo(sceneId: string): void {
        if (!this.container) return;
        if (this.currentScene && this.currentScene.id === sceneId) return;

        // Unmount current scene
        if (this.currentScene) {
            this.currentScene.unmount();
        }

        // Mount new scene
        const scene = this.scenes.get(sceneId);
        if (scene) {
            scene.mount(this.container);
            this.currentScene = scene;
            console.log(`[SceneManager] Switched to scene: ${sceneId}`);
        } else {
            console.warn(`[SceneManager] Scene not found: ${sceneId}`);
            this.currentScene = null;
        }
    }

    getCurrentScene(): VisualScene | null {
        return this.currentScene;
    }

    update(dt: number, context: VisualContext): void {
        if (this.currentScene) {
            this.currentScene.update(dt, context);
        }
    }

    destroy(): void {
        if (this.currentScene) {
            this.currentScene.unmount();
            this.currentScene = null;
        }
        this.scenes.clear();
        this.container = null;
    }
}
