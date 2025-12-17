/**
 * Client-side node graph types (for node-executor).
 *
 * Keep this minimal and data-only so graphs can be serialized safely.
 */

export type PortType =
    | 'number'
    | 'boolean'
    | 'string'
    | 'color'
    | 'client'
    | 'command'
    | 'fuzzy'
    | 'any';

export type PortKind = 'data' | 'sink';

export interface NodePort {
    id: string;
    label: string;
    type: PortType;
    defaultValue?: unknown;
    /**
     * `data` ports participate in the compute DAG.
     * `sink` ports are side-effect inputs delivered after compute.
     */
    kind?: PortKind;
}

export interface ConfigField {
    key: string;
    label: string;
    type: 'string' | 'number' | 'boolean' | 'select';
    defaultValue?: unknown;
    options?: { value: string; label: string }[];
}

export interface ProcessContext {
    nodeId: string;
    time: number;
    deltaTime: number;
}

export interface NodeDefinition {
    type: string;
    label: string;
    category: string;
    inputs: NodePort[];
    outputs: NodePort[];
    configSchema: ConfigField[];
    process: (
        inputs: Record<string, unknown>,
        config: Record<string, unknown>,
        context: ProcessContext
    ) => Record<string, unknown>;
    onSink?: (
        inputs: Record<string, unknown>,
        config: Record<string, unknown>,
        context: ProcessContext
    ) => void;
}

export interface NodeInstance {
    id: string;
    type: string;
    position: { x: number; y: number };
    config: Record<string, unknown>;
    inputValues: Record<string, unknown>;
    outputValues: Record<string, unknown>;
}

export interface Connection {
    id: string;
    sourceNodeId: string;
    sourcePortId: string;
    targetNodeId: string;
    targetPortId: string;
}

export interface GraphState {
    nodes: NodeInstance[];
    connections: Connection[];
}

