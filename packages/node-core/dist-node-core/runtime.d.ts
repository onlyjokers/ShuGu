import type { GraphState, NodeInstance } from './types.js';
import type { NodeRegistry } from './registry.js';
export type NodeRuntimeWatchdogInfo = {
    reason: 'compile-error' | 'sink-burst' | 'oscillation';
    message: string;
    diagnostics?: Record<string, unknown>;
};
export declare class NodeRuntime {
    private registry;
    private nodes;
    private connections;
    private executionOrder;
    private needsRecompile;
    private timer;
    private tickIntervalMs;
    private lastTickTime;
    private onTick;
    private onWatchdog;
    private isNodeEnabled;
    private isComputeEnabled;
    private isSinkEnabled;
    private lastEnabledStateByNode;
    private overridesByNode;
    private maxSinkValuesPerTick;
    private sinkValuesThisTick;
    private oscillation;
    private sinkSignatureHistory;
    private lastComputedInputsByNode;
    private lastOnSinkStateByNode;
    constructor(registry: NodeRegistry, options?: {
        tickIntervalMs?: number;
        onTick?: (info: {
            durationMs: number;
            time: number;
        }) => void;
        onWatchdog?: (info: NodeRuntimeWatchdogInfo) => void;
        /**
         * Gate for compute execution only. When false, compute and sinks are skipped and outputs are cleared,
         * but the node is not considered "disabled" for lifecycle purposes.
         */
        isComputeEnabled?: (nodeId: string) => boolean;
        /**
         * Gate for full node enable/disable. When false, the node is treated as stopped and `onDisable` may fire.
         */
        isNodeEnabled?: (nodeId: string) => boolean;
        isSinkEnabled?: (nodeId: string) => boolean;
        watchdog?: {
            maxSinkValuesPerTick?: number;
            oscillation?: {
                enabled?: boolean;
                windowSize?: number;
                minAlternatingLength?: number;
                windowMs?: number;
            };
        };
    });
    setTickIntervalMs(ms: number): void;
    loadGraph(state: Pick<GraphState, 'nodes' | 'connections'>): void;
    getNode(nodeId: string): NodeInstance | undefined;
    getGraphRef(): GraphState;
    exportGraph(): GraphState;
    compileNow(): void;
    start(): void;
    stop(): void;
    clear(): void;
    private runDisableHooks;
    private inferDisabledBypassPorts;
    private computeDisabledBypassOutputs;
    applyOverride(nodeId: string, kind: 'input' | 'config', key: string, value: unknown, ttlMs?: number): void;
    removeOverride(nodeId: string, kind: 'input' | 'config', key: string): void;
    clearOverrides(): void;
    private compile;
    private expireOverrides;
    private getInputOverride;
    private getEffectiveConfig;
    private countSinkValues;
    private commandSignature;
    private recordSinkSignature;
    private triggerWatchdog;
    private tick;
    private deepEqual;
    private diffCommandArray;
}
//# sourceMappingURL=runtime.d.ts.map