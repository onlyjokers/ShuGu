const DEFAULT_TICK_INTERVAL_MS = 33;
export class NodeRuntime {
    registry;
    nodes = new Map();
    connections = [];
    executionOrder = [];
    needsRecompile = true;
    timer = null;
    tickIntervalMs = DEFAULT_TICK_INTERVAL_MS;
    lastTickTime = 0;
    onTick = null;
    onWatchdog = null;
    isNodeEnabled = null;
    isComputeEnabled = null;
    isSinkEnabled = null;
    lastEnabledStateByNode = new Map();
    // Remote overrides (manager-driven) that take precedence over connections and local inputs.
    // Overrides are NOT written into node.inputValues / node.config so TTL expiry restores base values.
    overridesByNode = new Map();
    // Safety watchdogs (keep very lightweight for mobile).
    maxSinkValuesPerTick = 200;
    sinkValuesThisTick = 0;
    oscillation = {
        enabled: true,
        windowSize: 10,
        minAlternatingLength: 6,
        windowMs: 1000,
    };
    sinkSignatureHistory = new Map();
    // Cache last computed non-sink inputs so sinks can react to connected values (which are not stored in node.inputValues).
    lastComputedInputsByNode = new Map();
    lastOnSinkStateByNode = new Map();
    // Track whether a node had any sink connections in the previous tick.
    // This lets us fire `onDisable` (cleanup) when a sink is unplugged, and also ensures sinks re-run
    // when they get reconnected even if the value didn't change.
    lastHadSinkConnectionsByNode = new Map();
    constructor(registry, options) {
        this.registry = registry;
        if (typeof options?.tickIntervalMs === 'number' && Number.isFinite(options.tickIntervalMs)) {
            this.tickIntervalMs = Math.max(1, Math.floor(options.tickIntervalMs));
        }
        this.onTick = options?.onTick ?? null;
        this.onWatchdog = options?.onWatchdog ?? null;
        this.isComputeEnabled = options?.isComputeEnabled ?? null;
        this.isNodeEnabled = options?.isNodeEnabled ?? null;
        this.isSinkEnabled = options?.isSinkEnabled ?? null;
        const maxSink = options?.watchdog?.maxSinkValuesPerTick;
        if (typeof maxSink === 'number' && Number.isFinite(maxSink) && maxSink > 0) {
            this.maxSinkValuesPerTick = Math.floor(maxSink);
        }
        const osc = options?.watchdog?.oscillation;
        if (osc) {
            if (typeof osc.enabled === 'boolean')
                this.oscillation.enabled = osc.enabled;
            if (typeof osc.windowSize === 'number' &&
                Number.isFinite(osc.windowSize) &&
                osc.windowSize >= 4) {
                this.oscillation.windowSize = Math.floor(osc.windowSize);
            }
            if (typeof osc.minAlternatingLength === 'number' &&
                Number.isFinite(osc.minAlternatingLength) &&
                osc.minAlternatingLength >= 4) {
                this.oscillation.minAlternatingLength = Math.floor(osc.minAlternatingLength);
            }
            if (typeof osc.windowMs === 'number' && Number.isFinite(osc.windowMs) && osc.windowMs > 0) {
                this.oscillation.windowMs = Math.floor(osc.windowMs);
            }
        }
    }
    setTickIntervalMs(ms) {
        if (!Number.isFinite(ms))
            return;
        const next = Math.max(1, Math.floor(ms));
        if (next === this.tickIntervalMs)
            return;
        this.tickIntervalMs = next;
        if (this.timer) {
            this.stop();
            this.start();
        }
    }
    loadGraph(state) {
        this.nodes.clear();
        for (const node of state.nodes ?? []) {
            if (!this.registry.get(node.type)) {
                throw new Error(`unknown node type: ${node.type}`);
            }
            this.nodes.set(node.id, {
                ...node,
                config: { ...(node.config ?? {}) },
                inputValues: { ...(node.inputValues ?? {}) },
                outputValues: { ...(node.outputValues ?? {}) },
            });
        }
        const nodeIds = new Set(this.nodes.keys());
        const nextConnections = [];
        const connectedInputKeys = new Set();
        for (const conn of state.connections ?? []) {
            if (!nodeIds.has(conn.sourceNodeId) || !nodeIds.has(conn.targetNodeId)) {
                throw new Error(`invalid connection: ${conn.id}`);
            }
            const sourceNode = this.nodes.get(conn.sourceNodeId);
            const targetNode = this.nodes.get(conn.targetNodeId);
            const sourceDef = sourceNode ? this.registry.get(sourceNode.type) : undefined;
            const targetDef = targetNode ? this.registry.get(targetNode.type) : undefined;
            const sourcePort = sourceDef?.outputs.find((p) => p.id === conn.sourcePortId);
            const targetPort = targetDef?.inputs.find((p) => p.id === conn.targetPortId);
            if (!sourcePort || !targetPort)
                continue;
            const inputKey = `${String(conn.targetNodeId)}:${String(conn.targetPortId)}`;
            if (targetPort.kind !== 'sink') {
                if (connectedInputKeys.has(inputKey)) {
                    throw new Error(`input already connected: ${String(conn.targetNodeId)}:${String(conn.targetPortId)}`);
                }
                connectedInputKeys.add(inputKey);
            }
            nextConnections.push(conn);
        }
        this.connections = nextConnections;
        this.executionOrder = [];
        this.needsRecompile = true;
        this.lastTickTime = 0;
        this.overridesByNode.clear();
        this.sinkSignatureHistory.clear();
        this.lastComputedInputsByNode.clear();
        this.lastOnSinkStateByNode.clear();
        this.lastEnabledStateByNode.clear();
        this.lastHadSinkConnectionsByNode.clear();
    }
    getNode(nodeId) {
        return this.nodes.get(nodeId);
    }
    /**
     * Returns the latest computed non-sink input values for a node.
     *
     * Note: connected (non-sink) inputs are not stored in `node.inputValues`, so UIs that need
     * to reflect live connected inputs should use this accessor.
     */
    getLastComputedInputs(nodeId) {
        return this.lastComputedInputsByNode.get(nodeId) ?? null;
    }
    getGraphRef() {
        return {
            nodes: Array.from(this.nodes.values()),
            connections: [...this.connections],
        };
    }
    exportGraph() {
        return {
            nodes: Array.from(this.nodes.values()).map((n) => ({ ...n })),
            connections: [...this.connections],
        };
    }
    compileNow() {
        if (!this.needsRecompile)
            return;
        this.compile();
    }
    start() {
        if (this.timer)
            return;
        this.timer = setInterval(() => this.tick(), this.tickIntervalMs);
    }
    stop() {
        if (!this.timer)
            return;
        const now = Date.now();
        this.runDisableHooks(now);
        for (const node of this.nodes.values()) {
            node.outputValues = {};
        }
        this.lastComputedInputsByNode.clear();
        this.lastOnSinkStateByNode.clear();
        this.lastEnabledStateByNode.clear();
        this.lastHadSinkConnectionsByNode.clear();
        this.lastTickTime = 0;
        clearInterval(this.timer);
        this.timer = null;
    }
    clear() {
        this.stop();
        this.nodes.clear();
        this.connections = [];
        this.executionOrder = [];
        this.needsRecompile = true;
        this.lastTickTime = 0;
        this.overridesByNode.clear();
        this.sinkSignatureHistory.clear();
        this.lastComputedInputsByNode.clear();
        this.lastOnSinkStateByNode.clear();
        this.lastEnabledStateByNode.clear();
        this.lastHadSinkConnectionsByNode.clear();
    }
    runDisableHooks(now) {
        const nodesInOrder = this.executionOrder.length > 0 ? this.executionOrder : Array.from(this.nodes.values());
        const context = { nodeId: '', time: now, deltaTime: 0 };
        for (const node of nodesInOrder) {
            const def = this.registry.get(node.type);
            if (!def?.onDisable)
                continue;
            context.nodeId = node.id;
            const computedInputs = this.lastComputedInputsByNode.get(node.id) ?? null;
            const fullInputs = {};
            for (const port of def.inputs) {
                if (port.kind === 'sink') {
                    fullInputs[port.id] = node.inputValues[port.id];
                    continue;
                }
                if (computedInputs && Object.prototype.hasOwnProperty.call(computedInputs, port.id)) {
                    fullInputs[port.id] = computedInputs[port.id];
                }
                else {
                    fullInputs[port.id] = node.inputValues[port.id] ?? port.defaultValue;
                }
            }
            try {
                const effectiveConfig = this.getEffectiveConfig(node.id, node.config, now);
                def.onDisable(fullInputs, effectiveConfig, context);
            }
            catch (err) {
                console.error(`[NodeRuntime] onDisable error in ${node.type} (${node.id})`, err);
            }
        }
    }
    inferDisabledBypassPorts(def) {
        const inputs = Array.isArray(def.inputs) ? def.inputs : [];
        const outputs = Array.isArray(def.outputs) ? def.outputs : [];
        const inPort = inputs.find((p) => p.id === 'in') ?? null;
        const outPort = outputs.find((p) => p.id === 'out') ?? null;
        if (inPort && outPort && inPort.type === outPort.type) {
            if (inPort.type === 'command' || inPort.type === 'client')
                return null;
            return { inId: 'in', outId: 'out' };
        }
        if (inputs.length === 1 && outputs.length === 1) {
            const onlyIn = inputs[0];
            const onlyOut = outputs[0];
            if (onlyIn?.id && onlyOut?.id && onlyIn.type === onlyOut.type) {
                if (onlyIn.type === 'command' || onlyIn.type === 'client')
                    return null;
                return { inId: onlyIn.id, outId: onlyOut.id };
            }
        }
        const sinkInputs = inputs.filter((p) => p.kind === 'sink');
        const sinkOutputs = outputs.filter((p) => p.kind === 'sink');
        if (sinkInputs.length === 1 && sinkOutputs.length === 1) {
            const onlyIn = sinkInputs[0];
            const onlyOut = sinkOutputs[0];
            if (onlyIn?.id && onlyOut?.id && onlyIn.type === onlyOut.type) {
                if (onlyIn.type === 'command' || onlyIn.type === 'client')
                    return null;
                return { inId: onlyIn.id, outId: onlyOut.id };
            }
        }
        return null;
    }
    computeDisabledBypassOutputs(node) {
        const def = this.registry.get(node.type);
        if (!def)
            return null;
        const ports = this.inferDisabledBypassPorts(def);
        if (!ports)
            return null;
        const incoming = this.connections.filter((c) => c.targetNodeId === node.id && c.targetPortId === ports.inId);
        if (incoming.length === 0)
            return null;
        const outgoing = this.connections.filter((c) => c.sourceNodeId === node.id && c.sourcePortId === ports.outId);
        // Only treat it as a pass-through "wire" when both sides are connected.
        if (outgoing.length === 0)
            return null;
        let value = undefined;
        for (const conn of incoming) {
            const sourceNode = this.nodes.get(conn.sourceNodeId);
            if (!sourceNode)
                continue;
            const next = sourceNode.outputValues?.[conn.sourcePortId];
            if (value === undefined)
                value = next;
            else if (Array.isArray(value))
                value.push(next);
            else
                value = [value, next];
        }
        return { [ports.outId]: value };
    }
    applyOverride(nodeId, kind, key, value, ttlMs) {
        if (!nodeId || !key)
            return;
        const entry = this.overridesByNode.get(nodeId) ?? {
            input: new Map(),
            config: new Map(),
        };
        const bucket = kind === 'config' ? entry.config : entry.input;
        bucket.set(key, {
            value,
            updatedAt: Date.now(),
            ttlMs: typeof ttlMs === 'number' && Number.isFinite(ttlMs) && ttlMs > 0
                ? Math.floor(ttlMs)
                : undefined,
        });
        this.overridesByNode.set(nodeId, entry);
    }
    removeOverride(nodeId, kind, key) {
        const entry = this.overridesByNode.get(nodeId);
        if (!entry)
            return;
        const bucket = kind === 'config' ? entry.config : entry.input;
        bucket.delete(key);
        if (entry.input.size === 0 && entry.config.size === 0) {
            this.overridesByNode.delete(nodeId);
        }
    }
    clearOverrides() {
        this.overridesByNode.clear();
    }
    compile() {
        const nodes = Array.from(this.nodes.values());
        const nodeMap = new Map(nodes.map((n) => [n.id, n]));
        const inDegree = new Map();
        const outEdges = new Map();
        for (const node of nodes) {
            inDegree.set(node.id, 0);
            outEdges.set(node.id, []);
        }
        const uniqueEdges = new Set();
        for (const conn of this.connections) {
            const targetNode = nodeMap.get(conn.targetNodeId);
            if (targetNode) {
                const def = this.registry.get(targetNode.type);
                const port = def?.inputs.find((p) => p.id === conn.targetPortId);
                if (port?.kind === 'sink')
                    continue;
            }
            const edgeKey = `${conn.sourceNodeId}::${conn.targetNodeId}`;
            if (uniqueEdges.has(edgeKey))
                continue;
            uniqueEdges.add(edgeKey);
            inDegree.set(conn.targetNodeId, (inDegree.get(conn.targetNodeId) ?? 0) + 1);
            const outs = outEdges.get(conn.sourceNodeId) ?? [];
            if (!outs.includes(conn.targetNodeId))
                outs.push(conn.targetNodeId);
            outEdges.set(conn.sourceNodeId, outs);
        }
        const queue = [];
        const result = [];
        for (const [id, deg] of inDegree) {
            if (deg === 0)
                queue.push(id);
        }
        while (queue.length > 0) {
            const id = queue.shift();
            const node = nodeMap.get(id);
            if (node)
                result.push(node);
            for (const target of outEdges.get(id) ?? []) {
                const next = (inDegree.get(target) ?? 1) - 1;
                inDegree.set(target, next);
                if (next === 0)
                    queue.push(target);
            }
        }
        if (result.length !== nodes.length) {
            throw new Error('Cycle detected in compute graph (sink edges are allowed).');
        }
        this.executionOrder = result;
        this.needsRecompile = false;
    }
    expireOverrides(now) {
        if (this.overridesByNode.size === 0)
            return;
        for (const [nodeId, entry] of this.overridesByNode.entries()) {
            const clean = (bucket) => {
                for (const [key, ov] of bucket.entries()) {
                    if (!ov.ttlMs)
                        continue;
                    if (now - ov.updatedAt > ov.ttlMs)
                        bucket.delete(key);
                }
            };
            clean(entry.input);
            clean(entry.config);
            if (entry.input.size === 0 && entry.config.size === 0) {
                this.overridesByNode.delete(nodeId);
            }
        }
    }
    getInputOverride(nodeId, key) {
        const entry = this.overridesByNode.get(nodeId);
        if (!entry)
            return null;
        const ov = entry.input.get(key);
        return ov ?? null;
    }
    getEffectiveConfig(nodeId, base, now) {
        const entry = this.overridesByNode.get(nodeId);
        if (!entry || entry.config.size === 0)
            return base;
        const next = { ...base };
        for (const [key, ov] of entry.config.entries()) {
            if (ov.ttlMs && now - ov.updatedAt > ov.ttlMs)
                continue;
            next[key] = ov.value;
        }
        return next;
    }
    countSinkValues(value) {
        if (value === undefined || value === null)
            return 0;
        if (Array.isArray(value))
            return value.length;
        return 1;
    }
    commandSignature(value) {
        // Actions that are expected to be continuously updated (e.g., visual effects with
        // numeric parameters) should be excluded from oscillation detection. These commands
        // naturally change frequently when the user adjusts sliders/knobs.
        const continuousActions = new Set([
            'convolution',
            'asciiMode',
            'asciiResolution',
            'screenColor',
            'modulateSoundUpdate',
            'visualSceneBox',
            'visualSceneMel',
            'visualSceneFrontCamera',
            'visualSceneBackCamera',
        ]);
        const signatureFor = (cmd) => {
            if (!cmd || typeof cmd !== 'object')
                return null;
            const action = typeof cmd.action === 'string' ? cmd.action : '';
            if (!action)
                return null;
            // Skip oscillation detection for continuous/smoothly-updating actions.
            if (continuousActions.has(action))
                return null;
            const payload = cmd.payload && typeof cmd.payload === 'object' ? cmd.payload : {};
            const parts = [`a=${action}`];
            if (typeof payload.mode === 'string' && payload.mode)
                parts.push(`mode=${payload.mode}`);
            if (typeof payload.waveform === 'string' && payload.waveform)
                parts.push(`wave=${payload.waveform}`);
            if (typeof payload.sceneId === 'string' && payload.sceneId)
                parts.push(`scene=${payload.sceneId}`);
            if (typeof payload.transition === 'string' && payload.transition)
                parts.push(`trans=${payload.transition}`);
            if (action === 'flashlight' && payload.mode === 'blink') {
                const q = (n) => typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined;
                const freq = q(payload.frequency);
                const duty = q(payload.dutyCycle);
                if (freq !== undefined)
                    parts.push(`f=${freq}`);
                if (duty !== undefined)
                    parts.push(`d=${duty}`);
            }
            return parts.join(',');
        };
        if (Array.isArray(value)) {
            const items = value;
            const sigs = items
                .slice(0, 3)
                .map((v) => signatureFor(v))
                .filter(Boolean);
            if (sigs.length === 0)
                return null;
            const extra = items.length > 3 ? `+${items.length - 3}` : '';
            return `arr(${sigs.join('|')})${extra}`;
        }
        return signatureFor(value);
    }
    recordSinkSignature(key, signature, now) {
        const history = this.sinkSignatureHistory.get(key) ?? [];
        const next = [...history, { at: now, signature }].slice(-this.oscillation.windowSize);
        this.sinkSignatureHistory.set(key, next);
        if (!this.oscillation.enabled)
            return null;
        if (next.length < this.oscillation.minAlternatingLength)
            return null;
        const isAlternating = (slice) => {
            const uniq = new Set(slice.map((e) => e.signature));
            if (uniq.size !== 2)
                return false;
            for (let i = 1; i < slice.length; i++) {
                if (slice[i].signature === slice[i - 1].signature)
                    return false;
            }
            for (let i = 2; i < slice.length; i++) {
                if (slice[i].signature !== slice[i - 2].signature)
                    return false;
            }
            const span = slice[slice.length - 1].at - slice[0].at;
            return span >= 0 && span <= this.oscillation.windowMs;
        };
        for (let len = next.length; len >= this.oscillation.minAlternatingLength; len--) {
            const slice = next.slice(-len);
            if (!isAlternating(slice))
                continue;
            const a = slice[0]?.signature ?? '';
            const b = slice[1]?.signature ?? '';
            return {
                reason: 'oscillation',
                message: `oscillation detected (${len} alternating changes)`,
                diagnostics: { key, a, b, length: len, windowMs: this.oscillation.windowMs },
            };
        }
        return null;
    }
    triggerWatchdog(info) {
        try {
            this.onWatchdog?.(info);
        }
        catch {
            // ignore
        }
        this.stop();
    }
    tick() {
        const t0 = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
        const now = Date.now();
        this.sinkValuesThisTick = 0;
        this.expireOverrides(now);
        if (this.needsRecompile) {
            try {
                this.compile();
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                console.error('[NodeRuntime] compile error', err);
                this.triggerWatchdog({
                    reason: 'compile-error',
                    message,
                    diagnostics: { error: message },
                });
                const t1 = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
                this.onTick?.({ durationMs: t1 - t0, time: now });
                return;
            }
        }
        const deltaTime = this.lastTickTime > 0 ? now - this.lastTickTime : this.tickIntervalMs;
        this.lastTickTime = now;
        const context = { nodeId: '', time: now, deltaTime };
        // Compute pass
        for (const node of this.executionOrder) {
            const enabled = this.isNodeEnabled ? this.isNodeEnabled(node.id) : true;
            if (!enabled) {
                const prev = this.lastEnabledStateByNode.get(node.id);
                if (prev !== false) {
                    const def = this.registry.get(node.type);
                    if (def?.onDisable) {
                        const computedInputs = this.lastComputedInputsByNode.get(node.id) ?? null;
                        const fullInputs = {};
                        for (const port of def.inputs) {
                            if (port.kind === 'sink') {
                                fullInputs[port.id] = node.inputValues[port.id];
                                continue;
                            }
                            if (computedInputs && Object.prototype.hasOwnProperty.call(computedInputs, port.id)) {
                                fullInputs[port.id] = computedInputs[port.id];
                            }
                            else {
                                fullInputs[port.id] = node.inputValues[port.id] ?? port.defaultValue;
                            }
                        }
                        try {
                            context.nodeId = node.id;
                            const effectiveConfig = this.getEffectiveConfig(node.id, node.config, now);
                            def.onDisable(fullInputs, effectiveConfig, context);
                        }
                        catch (err) {
                            console.error(`[NodeRuntime] onDisable error in ${node.type} (${node.id})`, err);
                        }
                    }
                }
                this.lastEnabledStateByNode.set(node.id, false);
                // Reset sink state so re-enabling triggers `onSink` even if the inputs didn't change.
                this.lastOnSinkStateByNode.delete(node.id);
                this.lastHadSinkConnectionsByNode.set(node.id, false);
                node.outputValues = this.computeDisabledBypassOutputs(node) ?? {};
                continue;
            }
            this.lastEnabledStateByNode.set(node.id, true);
            if (this.isComputeEnabled && !this.isComputeEnabled(node.id)) {
                node.outputValues = {};
                continue;
            }
            const def = this.registry.get(node.type);
            if (!def)
                continue;
            const inputs = {};
            for (const port of def.inputs) {
                if (port.kind === 'sink')
                    continue;
                const ov = this.getInputOverride(node.id, port.id);
                if (ov && (!ov.ttlMs || now - ov.updatedAt <= ov.ttlMs)) {
                    inputs[port.id] = ov.value;
                    continue;
                }
                const conn = this.connections.find((c) => c.targetNodeId === node.id && c.targetPortId === port.id);
                if (conn) {
                    const sourceNode = this.nodes.get(conn.sourceNodeId);
                    inputs[port.id] = sourceNode ? sourceNode.outputValues[conn.sourcePortId] : undefined;
                    continue;
                }
                inputs[port.id] = node.inputValues[port.id] ?? port.defaultValue;
                node.inputValues[port.id] = inputs[port.id];
            }
            this.lastComputedInputsByNode.set(node.id, inputs);
            context.nodeId = node.id;
            try {
                const effectiveConfig = this.getEffectiveConfig(node.id, node.config, now);
                const outputs = def.process(inputs, effectiveConfig, context);
                node.outputValues = outputs;
            }
            catch (err) {
                console.error(`[NodeRuntime] process error in ${node.type} (${node.id})`, err);
            }
        }
        // Sink pass
        for (const node of this.executionOrder) {
            if (this.isNodeEnabled && !this.isNodeEnabled(node.id))
                continue;
            if (this.isComputeEnabled && !this.isComputeEnabled(node.id))
                continue;
            const def = this.registry.get(node.type);
            if (!def?.onSink)
                continue;
            if (this.isSinkEnabled && !this.isSinkEnabled(node.id))
                continue;
            const sinkValues = {};
            let sinkConnectionCount = 0;
            for (const conn of this.connections) {
                if (conn.targetNodeId !== node.id)
                    continue;
                const port = def.inputs.find((p) => p.id === conn.targetPortId);
                if (!port || port.kind !== 'sink')
                    continue;
                sinkConnectionCount += 1;
                const sourceNode = this.nodes.get(conn.sourceNodeId);
                if (!sourceNode)
                    continue;
                const value = sourceNode.outputValues[conn.sourcePortId];
                const prev = sinkValues[conn.targetPortId];
                if (prev === undefined)
                    sinkValues[conn.targetPortId] = value;
                else if (Array.isArray(prev))
                    prev.push(value);
                else
                    sinkValues[conn.targetPortId] = [prev, value];
            }
            if (sinkConnectionCount === 0) {
                const hadSink = this.lastHadSinkConnectionsByNode.get(node.id) ?? false;
                if (hadSink) {
                    // The sink was unplugged: fire cleanup and drop cached sink state so reconnecting
                    // replays the sink even when the payload is identical.
                    const computedInputs = this.lastComputedInputsByNode.get(node.id) ?? null;
                    const fullInputs = {};
                    for (const port of def.inputs) {
                        if (port.kind === 'sink') {
                            fullInputs[port.id] = node.inputValues[port.id];
                            continue;
                        }
                        if (computedInputs && Object.prototype.hasOwnProperty.call(computedInputs, port.id)) {
                            fullInputs[port.id] = computedInputs[port.id];
                        }
                        else {
                            fullInputs[port.id] = node.inputValues[port.id] ?? port.defaultValue;
                        }
                    }
                    try {
                        if (def.onDisable) {
                            context.nodeId = node.id;
                            const effectiveConfig = this.getEffectiveConfig(node.id, node.config, now);
                            def.onDisable(fullInputs, effectiveConfig, context);
                        }
                    }
                    catch (err) {
                        console.error(`[NodeRuntime] onDisable error in ${node.type} (${node.id})`, err);
                    }
                    finally {
                        this.lastOnSinkStateByNode.delete(node.id);
                    }
                }
                this.lastHadSinkConnectionsByNode.set(node.id, false);
                continue;
            }
            this.lastHadSinkConnectionsByNode.set(node.id, true);
            const computedInputs = this.lastComputedInputsByNode.get(node.id) ?? null;
            const fullInputs = {};
            for (const port of def.inputs) {
                if (port.kind === 'sink') {
                    if (Object.prototype.hasOwnProperty.call(sinkValues, port.id)) {
                        fullInputs[port.id] = sinkValues[port.id];
                    }
                    continue;
                }
                if (computedInputs && Object.prototype.hasOwnProperty.call(computedInputs, port.id)) {
                    fullInputs[port.id] = computedInputs[port.id];
                }
                else {
                    fullInputs[port.id] = node.inputValues[port.id] ?? port.defaultValue;
                }
            }
            // Store the latest sink values for UI/debugging regardless of whether we run the sink.
            for (const [portId, next] of Object.entries(sinkValues)) {
                node.inputValues[portId] = next;
            }
            const effectiveConfig = this.getEffectiveConfig(node.id, node.config, now);
            const prevState = this.lastOnSinkStateByNode.get(node.id);
            const inputsChanged = !prevState || !this.deepEqual(prevState.inputs, fullInputs);
            const configChanged = !prevState || !this.deepEqual(prevState.config, effectiveConfig);
            if (!inputsChanged && !configChanged)
                continue;
            let nonSinkChanged = false;
            if (prevState) {
                for (const port of def.inputs) {
                    if (port.kind === 'sink')
                        continue;
                    if (!this.deepEqual(prevState.inputs[port.id], fullInputs[port.id])) {
                        nonSinkChanged = true;
                        break;
                    }
                }
            }
            else {
                nonSinkChanged = true;
            }
            const sinkInputs = { ...fullInputs };
            const allowCommandDiff = prevState !== undefined && !nonSinkChanged && !configChanged;
            // Special-case: for "command" sink ports receiving multiple commands, only deliver the changed
            // subset. This avoids re-triggering unrelated effects when one command in the bundle changes.
            if (allowCommandDiff && prevState) {
                for (const port of def.inputs) {
                    if (port.kind !== 'sink' || port.type !== 'command')
                        continue;
                    const portId = port.id;
                    const next = fullInputs[portId];
                    const prev = prevState.inputs[portId];
                    if (!Array.isArray(next) || !Array.isArray(prev))
                        continue;
                    sinkInputs[portId] = this.diffCommandArray(prev, next);
                }
            }
            // Count sink values for a simple burst watchdog.
            for (const port of def.inputs) {
                if (port.kind !== 'sink')
                    continue;
                this.sinkValuesThisTick += this.countSinkValues(sinkInputs[port.id]);
            }
            if (this.sinkValuesThisTick > this.maxSinkValuesPerTick) {
                this.triggerWatchdog({
                    reason: 'sink-burst',
                    message: `sink burst exceeded budget (${this.sinkValuesThisTick} > ${this.maxSinkValuesPerTick})`,
                    diagnostics: {
                        maxSinkValuesPerTick: this.maxSinkValuesPerTick,
                        sinkValuesThisTick: this.sinkValuesThisTick,
                        nodeId: node.id,
                    },
                });
                break;
            }
            // Oscillation watchdog (only for command-like sinks).
            if (this.oscillation.enabled) {
                for (const port of def.inputs) {
                    if (port.kind !== 'sink')
                        continue;
                    const portId = port.id;
                    const signature = this.commandSignature(sinkInputs[portId]);
                    if (!signature)
                        continue;
                    const key = `${node.id}:${portId}`;
                    const watchdog = this.recordSinkSignature(key, signature, now);
                    if (watchdog) {
                        this.triggerWatchdog(watchdog);
                        break;
                    }
                }
            }
            if (!this.timer)
                break;
            context.nodeId = node.id;
            try {
                def.onSink(sinkInputs, effectiveConfig, context);
            }
            catch (err) {
                console.error(`[NodeRuntime] sink error in ${node.type} (${node.id})`, err);
            }
            finally {
                this.lastOnSinkStateByNode.set(node.id, { inputs: fullInputs, config: effectiveConfig });
            }
            if (!this.timer)
                break;
        }
        const t1 = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
        this.onTick?.({ durationMs: t1 - t0, time: now });
    }
    deepEqual(a, b) {
        if (a === b)
            return true;
        if (a && b && typeof a === 'object' && typeof b === 'object') {
            try {
                return JSON.stringify(a) === JSON.stringify(b);
            }
            catch {
                return false;
            }
        }
        return false;
    }
    diffCommandArray(prev, next) {
        const signatureOf = (value) => {
            if (value === null)
                return 'null';
            if (value === undefined)
                return 'undefined';
            if (typeof value === 'string')
                return `str:${value}`;
            if (typeof value === 'number')
                return Number.isFinite(value) ? `num:${value}` : `num:${String(value)}`;
            if (typeof value === 'boolean')
                return `bool:${value}`;
            try {
                return `json:${JSON.stringify(value)}`;
            }
            catch {
                return `obj:${Object.prototype.toString.call(value)}`;
            }
        };
        const keyFor = (cmd, counts) => {
            const action = typeof cmd?.action === 'string' ? String(cmd.action) : '';
            if (!action)
                return '';
            const idx = counts.get(action) ?? 0;
            counts.set(action, idx + 1);
            return `${action}#${idx}`;
        };
        const prevSignatures = new Map();
        const prevCounts = new Map();
        for (const cmd of prev) {
            const key = keyFor(cmd, prevCounts);
            if (!key)
                continue;
            prevSignatures.set(key, signatureOf(cmd));
        }
        const changed = [];
        const nextCounts = new Map();
        for (const cmd of next) {
            const key = keyFor(cmd, nextCounts);
            // If we can't key this command, treat it as changed (best-effort safety).
            if (!key) {
                changed.push(cmd);
                continue;
            }
            const sig = signatureOf(cmd);
            if (prevSignatures.get(key) !== sig)
                changed.push(cmd);
        }
        return changed;
    }
}
//# sourceMappingURL=runtime.js.map