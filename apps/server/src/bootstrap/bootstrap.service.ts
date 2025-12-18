import { Injectable } from '@nestjs/common';

export type VisualBootstrapConfig = {
  sceneId: string;
  asciiEnabled: boolean;
  asciiResolution: number;
  updatedAt: number;
};

@Injectable()
export class BootstrapService {
  private visual: VisualBootstrapConfig | null = null;

  getVisual(): VisualBootstrapConfig | null {
    return this.visual;
  }

  setVisual(input: Omit<VisualBootstrapConfig, 'updatedAt'>): VisualBootstrapConfig {
    const next: VisualBootstrapConfig = {
      ...input,
      updatedAt: Date.now(),
    };
    this.visual = next;
    return next;
  }

  clearVisual(): void {
    this.visual = null;
  }
}

