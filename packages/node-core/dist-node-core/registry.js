export class NodeRegistry {
    definitions = new Map();
    register(definition) {
        this.definitions.set(definition.type, definition);
    }
    get(type) {
        return this.definitions.get(type);
    }
    list() {
        return Array.from(this.definitions.values());
    }
    listByCategory() {
        const categories = new Map();
        for (const def of this.definitions.values()) {
            const list = categories.get(def.category) ?? [];
            list.push(def);
            categories.set(def.category, list);
        }
        return categories;
    }
}
//# sourceMappingURL=registry.js.map