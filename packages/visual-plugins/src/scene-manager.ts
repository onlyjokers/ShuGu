/**
 * Scene Manager - Manages visual scene switching and lifecycle
 */

import type { VisualScene, VisualContext, SceneManager } from './types.js';

export class DefaultSceneManager implements SceneManager {
    private scenes: Map<string, VisualScene> = new Map();
    private currentScene: VisualScene | null = null;
    private activeScenes: Set<string> = new Set();
    private container: HTMLElement | null = null;

    constructor(container: HTMLElement) {
        this.container = container;
    }

    register(scene: VisualScene): void {
        this.scenes.set(scene.id, scene);
    }

    /**
     * Enable or disable a specific scene independently.
     * Multiple scenes can be enabled simultaneously.
     */
    setSceneEnabled(sceneId: string, enabled: boolean): void {
        if (!this.container) return;

        const scene = this.scenes.get(sceneId);
        if (!scene) {
            console.warn(`[SceneManager] Scene not found: ${sceneId}`);
            return;
        }

        const wasActive = this.activeScenes.has(sceneId);

        if (enabled && !wasActive) {
            scene.mount(this.container);
            this.activeScenes.add(sceneId);
            console.log(`[SceneManager] Enabled scene: ${sceneId}`);
        } else if (!enabled && wasActive) {
            scene.unmount();
            this.activeScenes.delete(sceneId);
            console.log(`[SceneManager] Disabled scene: ${sceneId}`);
        }
    }

    /**
     * Switch to a single scene (legacy behavior - disables all other scenes).
     * Kept for backward compatibility.
     */
    switchTo(sceneId: string): void {
        if (!this.container) return;
        if (this.currentScene && this.currentScene.id === sceneId) return;

        // Unmount current scene
        if (this.currentScene) {
            this.currentScene.unmount();
            this.activeScenes.delete(this.currentScene.id);
        }

        // Mount new scene
        const scene = this.scenes.get(sceneId);
        if (scene) {
            scene.mount(this.container);
            this.currentScene = scene;
            this.activeScenes.add(sceneId);
            console.log(`[SceneManager] Switched to scene: ${sceneId}`);
        } else {
            console.warn(`[SceneManager] Scene not found: ${sceneId}`);
            this.currentScene = null;
        }
    }

    getCurrentScene(): VisualScene | null {
        return this.currentScene;
    }

    getActiveScenes(): VisualScene[] {
        return Array.from(this.activeScenes)
            .map(id => this.scenes.get(id))
            .filter((s): s is VisualScene => s !== undefined);
    }

    update(dt: number, context: VisualContext): void {
        // Update all active scenes
        for (const sceneId of this.activeScenes) {
            const scene = this.scenes.get(sceneId);
            if (scene) {
                scene.update(dt, context);
            }
        }
    }

    destroy(): void {
        // Unmount all active scenes
        for (const sceneId of this.activeScenes) {
            const scene = this.scenes.get(sceneId);
            if (scene) {
                scene.unmount();
            }
        }
        this.activeScenes.clear();
        this.currentScene = null;
        this.scenes.clear();
        this.container = null;
    }
}
