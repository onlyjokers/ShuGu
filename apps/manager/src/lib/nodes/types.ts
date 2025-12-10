/**
 * Node Graph Type Definitions
 */

export type PortType = 'number' | 'boolean' | 'string' | 'any';
export type NodeMode = 'REMOTE' | 'MODULATION';

export interface NodePort {
  id: string;
  label: string;
  type: PortType;
  defaultValue?: unknown;
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
}

export interface ConfigField {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'param-path';
  defaultValue?: unknown;
  options?: { value: string; label: string }[];
}

export interface ProcessContext {
  nodeId: string;
  time: number;  // Current time in ms
  deltaTime: number;  // Time since last tick
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
