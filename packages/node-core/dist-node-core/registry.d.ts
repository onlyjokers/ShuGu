import type { NodeDefinition } from './types.js';
export declare class NodeRegistry {
    private definitions;
    register(definition: NodeDefinition): void;
    get(type: string): NodeDefinition | undefined;
    list(): NodeDefinition[];
    listByCategory(): Map<string, NodeDefinition[]>;
}
//# sourceMappingURL=registry.d.ts.map