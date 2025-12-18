import type { NodeDefinition } from './types.js';

export class NodeRegistry {
  private definitions = new Map<string, NodeDefinition>();

  register(definition: NodeDefinition): void {
    this.definitions.set(definition.type, definition);
  }

  get(type: string): NodeDefinition | undefined {
    return this.definitions.get(type);
  }

  list(): NodeDefinition[] {
    return Array.from(this.definitions.values());
  }

  listByCategory(): Map<string, NodeDefinition[]> {
    const categories = new Map<string, NodeDefinition[]>();
    for (const def of this.definitions.values()) {
      const list = categories.get(def.category) ?? [];
      list.push(def);
      categories.set(def.category, list);
    }
    return categories;
  }
}
