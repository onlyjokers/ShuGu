import { parameterRegistry } from './registry';
import type { Parameter } from './parameter';
import type { ParameterSource } from './types';

export type ModulationValue = number | null | undefined;
export type ModulationSourceFn = () => ModulationValue;

export interface ModulationLinkOptions {
  id: string;
  targetPath: string;
  source: ModulationSourceFn;
  amount?: number;
  sourceTag?: ParameterSource;
  transform?: (value: number) => number;
}

/**
  * One modulation link connects a numeric source (e.g. MIDI CC) to a target Parameter.
  * The Parameter holds the aggregated modulation offset from all links.
  */
export class ModulationLink {
  readonly id: string;
  readonly targetPath: string;
  private target: Parameter<number> | undefined;
  private source: ModulationSourceFn;
  private amount: number;
  private transform?: (value: number) => number;
  private sourceTag: ParameterSource;

  constructor(options: ModulationLinkOptions) {
    this.id = options.id;
    this.targetPath = options.targetPath;
    this.source = options.source;
    this.amount = options.amount ?? 1;
    this.transform = options.transform;
    this.sourceTag = options.sourceTag ?? 'midi';
    this.target = parameterRegistry.get<number>(options.targetPath);
  }

  setAmount(amount: number): void {
    this.amount = amount;
  }

  /**
   * Pull once from the source and write the modulation offset into the Parameter.
   */
  tick(): void {
    if (!this.target) return;
    const value = this.source();
    if (value === null || value === undefined) return;
    const normalized = typeof value === 'number' ? value : Number(value);
    const offset = this.transform ? this.transform(normalized) : normalized * this.amount;
    this.target.setModulation(this.id, offset, this.sourceTag);
  }

  detach(): void {
    this.target?.clearModulation(this.id, this.sourceTag);
  }
}

/**
 * A small scheduler to drive multiple modulation links.
 */
export class ModulationMatrix {
  private links = new Map<string, ModulationLink>();
  private timer: ReturnType<typeof setInterval> | null = null;

  addLink(options: ModulationLinkOptions): ModulationLink {
    const link = new ModulationLink(options);
    this.links.set(options.id, link);
    return link;
  }

  removeLink(id: string): void {
    const link = this.links.get(id);
    link?.detach();
    this.links.delete(id);
  }

  tick(): void {
    this.links.forEach((link) => link.tick());
  }

  /**
   * Start a polling loop. This stays headless; callers manage the loop lifecycle.
   */
  start(intervalMs = 30): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), intervalMs);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  clear(): void {
    this.links.forEach((link) => link.detach());
    this.links.clear();
  }
}
