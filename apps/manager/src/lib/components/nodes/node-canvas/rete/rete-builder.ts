/**
 * Purpose: Build Rete nodes and apply dynamic port constraints.
 */
import { get } from 'svelte/store';
import { ClassicPreset } from 'rete';
import type { AreaPlugin } from 'rete-area-plugin';
import type { NodeInstance, NodePort, PortType, Connection as EngineConnection } from '$lib/nodes/types';
import type { NodeRegistry } from '@shugu/node-core';
import { audienceClients } from '$lib/stores/manager';
import {
  BooleanControl,
  ClientPickerControl,
  ClientSensorValueControl,
  AssetPickerControl,
  LocalAssetPickerControl,
  FilePickerControl,
  MidiLearnControl,
  SelectControl,
  TimeRangeControl,
} from './rete-controls';

type ReteSocketMap = Record<string, ClassicPreset.Socket>;
type AnyAreaPlugin = AreaPlugin<any, any>;

type ReteBuilderOptions = {
  nodeRegistry: NodeRegistry;
  nodeEngine: {
    getNode?: (nodeId: string) => NodeInstance | undefined;
    updateNodeInputValue: (nodeId: string, portId: string, value: unknown) => void;
    updateNodeConfig: (nodeId: string, config: Record<string, unknown>) => void;
  };
  sockets: ReteSocketMap;
  getNumberParamOptions: () => { path: string; label: string }[];
  sendNodeOverride: (nodeId: string, kind: 'input' | 'config', portId: string, value: unknown) => void;
  onClientNodePick?: (nodeId: string, clientId: string) => void;
  onClientNodeSelectInput?: (nodeId: string, portId: 'index' | 'range', value: number) => void;
  onClientNodeRandom?: (nodeId: string, value: boolean) => void;
};

export type ReteBuilder = {
  nodeLabel: (node: NodeInstance) => string;
  socketFor: (type?: string) => ClassicPreset.Socket;
  buildReteNode: (instance: NodeInstance) => any;
  applyMidiMapRangeConstraints: (
    state: { nodes: NodeInstance[]; connections: EngineConnection[] },
    areaPlugin: AnyAreaPlugin | null | undefined,
    nodeMap: Map<string, any>
  ) => Promise<void>;
  isCompatible: (sourceType: PortType, targetType: PortType) => boolean;
  getPortDefForSocket: (socket: { nodeId: string; side: 'input' | 'output'; key: string }) => NodePort | null;
  bestMatchingPort: (
    ports: NodePort[],
    requiredType: PortType,
    portSide: 'input' | 'output'
  ) => NodePort | null;
  inputAllowsMultiple: (nodeId: string, inputKey: string) => boolean;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clampNumber(value: number, min: number | undefined, max: number | undefined): number {
  let next = value;
  if (typeof min === 'number' && Number.isFinite(min)) next = Math.max(min, next);
  if (typeof max === 'number' && Number.isFinite(max)) next = Math.min(max, next);
  return next;
}

export function createReteBuilder(opts: ReteBuilderOptions): ReteBuilder {
  const { nodeRegistry, nodeEngine, sockets, sendNodeOverride, getNumberParamOptions } = opts;

  const nodeLabel = (node: NodeInstance): string => {
    if (node.type === 'client-object') {
      const onlineCount = get(audienceClients).length;
      return `Client: ${onlineCount} online`;
    }
    return nodeRegistry.get(node.type)?.label ?? node.type;
  };

  const socketFor = (type?: string) => {
    if (type && type in sockets) return sockets[type as keyof typeof sockets];
    return sockets.any;
  };

  const buildReteNode = (instance: NodeInstance): any => {
    const def = nodeRegistry.get(instance.type);
    const node: any = new ClassicPreset.Node(nodeLabel(instance));
    const configFields = def?.configSchema ?? [];
    const configFieldByKey = new Map<string, any>();
    for (const field of configFields) configFieldByKey.set(field.key, field);
    const inputControlKeys = new Set<string>();
    node.id = instance.id;

    const cmdAggInputCount = (() => {
      if (instance.type !== 'cmd-aggregator') return null;
      const raw = (instance.config as any)?.inCount;
      const n = typeof raw === 'number' ? raw : Number(raw);
      return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1;
    })();

    for (const input of def?.inputs ?? []) {
      if (cmdAggInputCount !== null) {
        const match = /^in(\d+)$/.exec(String(input.id));
        if (match) {
          const idx = Number(match[1]);
          if (!Number.isFinite(idx) || idx <= 0) continue;
          if (idx > cmdAggInputCount) continue;
        }
      }
      // Allow users to attempt multiple links; NodeEngine enforces the global rule that each input
      // port can only be connected once (and shows the error message on violation).
      const inp = new ClassicPreset.Input(socketFor(input.type), input.label ?? input.id, true);

      const hasDefault = input.defaultValue !== undefined;
      const isPrimitive = input.type === 'number' || input.type === 'string' || input.type === 'boolean';
      const isSink = input.kind === 'sink';
      const configField = configFieldByKey.get(input.id);
      const isSelectConfig = configField?.type === 'select';
      const configValue = instance.config?.[input.id];
      const current = instance.inputValues?.[input.id];
      const derivedDefault = hasDefault ? input.defaultValue : configField?.defaultValue;
      const forceInlineInput =
        instance.type === 'client-object' && (input.id === 'index' || input.id === 'range' || input.id === 'random');
      const hasInitial =
        forceInlineInput || current !== undefined || configValue !== undefined || derivedDefault !== undefined;
      if (hasInitial && isPrimitive && !isSink && !isSelectConfig) {
        if (input.type === 'number') {
          const min =
            typeof input.min === 'number'
              ? input.min
              : typeof configField?.min === 'number'
                ? configField.min
                : undefined;
          const max =
            typeof input.max === 'number'
              ? input.max
              : typeof configField?.max === 'number'
                ? configField.max
                : undefined;
          const step =
            typeof input.step === 'number'
              ? input.step
              : typeof configField?.step === 'number'
                ? configField.step
                : undefined;

          const initial =
            typeof current === 'number'
              ? current
              : typeof configValue === 'number'
                ? configValue
                : forceInlineInput
                  ? 1
                  : Number(derivedDefault ?? 0);

          const clamp = (value: number) => {
            let next = value;
            if (typeof min === 'number' && Number.isFinite(min)) next = Math.max(min, next);
            if (typeof max === 'number' && Number.isFinite(max)) next = Math.min(max, next);
            return next;
          };

          inp.addControl(
            (() => {
              const control: any = new ClassicPreset.InputControl('number', {
                initial: clamp(initial),
                change: (value) => {
                  const next = typeof value === 'number' ? clamp(value) : value;
                  nodeEngine.updateNodeInputValue(instance.id, input.id, next);
                  sendNodeOverride(instance.id, 'input', input.id, next);
                  if (
                    instance.type === 'client-object' &&
                    (input.id === 'index' || input.id === 'range') &&
                    typeof next === 'number'
                  ) {
                    opts.onClientNodeSelectInput?.(instance.id, input.id, next);
                  }
                },
              });
              control.inline = true;
              control.min = min;
              control.max = max;
              control.step = step;
              control.nodeId = instance.id;
              control.nodeType = instance.type;
              control.portId = input.id;
              if (instance.type === 'client-object' && (input.id === 'index' || input.id === 'range')) {
                control.integer = true;
              }
              return control;
            })()
          );
        } else if (input.type === 'string') {
          const initial =
            typeof current === 'string'
              ? current
              : typeof configValue === 'string'
                ? configValue
                : String(derivedDefault ?? '');
          const control: any = new ClassicPreset.InputControl('text', {
            initial,
            change: (value) => {
              nodeEngine.updateNodeInputValue(instance.id, input.id, value);
              sendNodeOverride(instance.id, 'input', input.id, value);
            },
          });
          control.inline = true;
          inp.addControl(control);
        } else if (input.type === 'boolean') {
          const initial =
            typeof current === 'boolean'
              ? current
              : typeof configValue === 'boolean'
                ? configValue
                : forceInlineInput
                  ? false
                  : Boolean(derivedDefault);
          const control: any = new BooleanControl({
            initial,
            change: (value) => {
              nodeEngine.updateNodeInputValue(instance.id, input.id, value);
              sendNodeOverride(instance.id, 'input', input.id, value);
              if (instance.type === 'client-object' && input.id === 'random') {
                opts.onClientNodeRandom?.(instance.id, value);
              }
            },
          });
          control.inline = true;
          inp.addControl(control);
        }
        inp.showControl = true;
        inputControlKeys.add(input.id);
      }

      if (!isSink && input.type === 'color') {
        const initial =
          typeof current === 'string'
            ? String(current)
            : typeof instance.config?.[input.id] === 'string'
              ? String(instance.config[input.id])
              : String(derivedDefault ?? '#ffffff');
        inp.addControl(
          (() => {
            const control: any = new ClassicPreset.InputControl('text', {
              initial,
              change: (value) => {
                nodeEngine.updateNodeInputValue(instance.id, input.id, value);
                sendNodeOverride(instance.id, 'input', input.id, value);
              },
            });
            control.inline = true;
            return control;
          })()
        );
        inp.showControl = true;
        inputControlKeys.add(input.id);
      }

      if (!isSink && configField?.type === 'select') {
        const initial =
          typeof current === 'string'
            ? String(current)
            : typeof instance.config?.[input.id] === 'string'
              ? String(instance.config[input.id])
              : String(configField.defaultValue ?? '');
        const control: any = new SelectControl({
          initial,
          options: configField.options ?? [],
          change: (value) => {
            nodeEngine.updateNodeInputValue(instance.id, input.id, value);
            sendNodeOverride(instance.id, 'input', input.id, value);
          },
        });
        control.inline = true;
        inp.addControl(control);
        inp.showControl = true;
        inputControlKeys.add(input.id);
      }

      node.addInput(input.id, inp);
    }

    for (const output of def?.outputs ?? []) {
      const out: any = new ClassicPreset.Output(socketFor(output.type), output.label ?? output.id);
      if (instance.type === 'proc-client-sensors') {
        out.control = new ClientSensorValueControl({ nodeId: instance.id, portId: output.id });
      }
      node.addOutput(output.id, out);
    }

    for (const field of def?.configSchema ?? []) {
      if (inputControlKeys.has(field.key)) continue;
      const key = field.key;
      const current = instance.config?.[key] ?? field.defaultValue;
      if (field.type === 'select') {
        node.addControl(
          key,
          new SelectControl({
            label: field.label,
            initial: String(current ?? ''),
            options: field.options ?? [],
            change: (value) => {
              nodeEngine.updateNodeConfig(instance.id, { [key]: value });
              sendNodeOverride(instance.id, 'config', key, value);
            },
          })
        );
      } else if (field.type === 'boolean') {
        const initial = (() => {
          const coerceBoolean = (value: unknown): boolean | null => {
            if (typeof value === 'boolean') return value;
            if (typeof value === 'number' && Number.isFinite(value)) return value >= 0.5;
            if (typeof value === 'string') {
              const s = value.trim().toLowerCase();
              if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true;
              if (s === 'false' || s === '0' || s === 'no' || s === 'off') return false;
            }
            return null;
          };

          const fromCurrent = coerceBoolean(current);
          if (fromCurrent !== null) return fromCurrent;

          const fallback = coerceBoolean(field.defaultValue);
          if (fallback !== null) return fallback;
          return false;
        })();

        node.addControl(
          key,
          new BooleanControl({
            label: field.label,
            initial,
            change: (value) => {
              nodeEngine.updateNodeConfig(instance.id, { [key]: value });
              sendNodeOverride(instance.id, 'config', key, value);
            },
          })
        );
      } else if (field.type === 'number') {
        const clamp = (value: number) => {
          let next = value;
          const min = typeof field.min === 'number' ? field.min : undefined;
          const max = typeof field.max === 'number' ? field.max : undefined;
          if (typeof min === 'number' && Number.isFinite(min)) next = Math.max(min, next);
          if (typeof max === 'number' && Number.isFinite(max)) next = Math.min(max, next);
          return next;
        };

        const control: any = new ClassicPreset.InputControl('number', {
          initial: clamp(Number(current ?? 0)),
          change: (value) => {
            const next = typeof value === 'number' ? clamp(value) : value;
            nodeEngine.updateNodeConfig(instance.id, { [key]: next });
            sendNodeOverride(instance.id, 'config', key, next);
          },
        });
        control.controlLabel = field.label;
        control.min = field.min;
        control.max = field.max;
        control.step = field.step;
        node.addControl(key, control);
      } else if (field.type === 'client-picker') {
        const control: any = new ClientPickerControl({
          label: field.label,
          initial: String(current ?? ''),
          change: (value) => {
            nodeEngine.updateNodeConfig(instance.id, { [key]: value });
            if (instance.type === 'client-object') {
              opts.onClientNodePick?.(instance.id, value);
            }
          },
        });
        control.nodeId = instance.id;
        control.nodeType = instance.type;
        node.addControl(key, control);
      } else if (field.type === 'asset-picker') {
        const control: any = new AssetPickerControl({
          label: field.label,
          initial: String(current ?? ''),
          assetKind: (field as any).assetKind ?? 'any',
          change: (value) => {
            nodeEngine.updateNodeConfig(instance.id, { [key]: value });
            sendNodeOverride(instance.id, 'config', key, value);
          },
        });
        node.addControl(key, control);
      } else if (field.type === 'local-asset-picker') {
        const control: any = new LocalAssetPickerControl({
          label: field.label,
          initial: String(current ?? ''),
          assetKind: (field as any).assetKind ?? 'any',
          change: (value) => {
            nodeEngine.updateNodeConfig(instance.id, { [key]: value });
            sendNodeOverride(instance.id, 'config', key, value);
          },
        });
        node.addControl(key, control);
      } else if (field.type === 'param-path') {
        node.addControl(
          key,
          new SelectControl({
            label: field.label,
            placeholder: 'Select parameter…',
            initial: String(current ?? ''),
            options: getNumberParamOptions().map((p) => ({
              value: p.path,
              label: `${p.label} (${p.path})`,
            })),
            change: (value) => {
              nodeEngine.updateNodeConfig(instance.id, { [key]: value });
              sendNodeOverride(instance.id, 'config', key, value);
            },
          })
        );
      } else if (field.type === 'file') {
        node.addControl(
          key,
          new FilePickerControl({
            label: field.label,
            initial: typeof current === 'string' ? current : '',
            accept: field.accept,
            buttonLabel: field.buttonLabel,
            change: (value) => {
              nodeEngine.updateNodeConfig(instance.id, { [key]: value });
              sendNodeOverride(instance.id, 'config', key, value);
            },
          })
        );
      } else if (field.type === 'midi-source') {
        node.addControl(key, new MidiLearnControl({ nodeId: instance.id, label: field.label }));
      } else if (field.type === 'time-range') {
        const raw = current as any;
        const startSec =
          typeof raw?.startSec === 'number' && Number.isFinite(raw.startSec) ? raw.startSec : 0;
        const endSec = typeof raw?.endSec === 'number' && Number.isFinite(raw.endSec) ? raw.endSec : -1;

        const control: any = new TimeRangeControl({
          label: field.label,
          initial: { startSec, endSec, cursorSec: typeof raw?.cursorSec === 'number' ? raw.cursorSec : -1 } as any,
          min: field.min,
          max: field.max,
          step: field.step,
          change: (value) => {
            // Special: asset timeline controls are UI helpers which update input ports (so they are connectable/modulatable).
            const timelineNodeTypes = new Set([
              'load-audio-from-assets',
              'load-video-from-assets',
              'load-audio-from-local',
              'load-video-from-local',
            ]);
            if (timelineNodeTypes.has(instance.type)) {
              const nextStart = typeof (value as any)?.startSec === 'number' ? (value as any).startSec : 0;
              const nextEnd = typeof (value as any)?.endSec === 'number' ? (value as any).endSec : -1;
              const nextCursor = (value as any)?.cursorSec;

              nodeEngine.updateNodeInputValue(instance.id, 'startSec', nextStart);
              sendNodeOverride(instance.id, 'input', 'startSec', nextStart);

              nodeEngine.updateNodeInputValue(instance.id, 'endSec', nextEnd);
              sendNodeOverride(instance.id, 'input', 'endSec', nextEnd);

              if (typeof nextCursor === 'number' && Number.isFinite(nextCursor)) {
                nodeEngine.updateNodeInputValue(instance.id, 'cursorSec', nextCursor);
                sendNodeOverride(instance.id, 'input', 'cursorSec', nextCursor);
              }

              // Keep config in sync for persistence/debugging (not used by runtime).
              nodeEngine.updateNodeConfig(instance.id, { [key]: value });
              return;
            }

            nodeEngine.updateNodeConfig(instance.id, { [key]: value });
            sendNodeOverride(instance.id, 'config', key, value);
          },
        });
        control.nodeId = instance.id;
        control.nodeType = instance.type;
        control.configKey = key;
        node.addControl(key, control);
      } else {
        const control: any = new ClassicPreset.InputControl('text', {
          initial: String(current ?? ''),
          change: (value) => {
            nodeEngine.updateNodeConfig(instance.id, { [key]: value });
            sendNodeOverride(instance.id, 'config', key, value);
          },
        });
        control.controlLabel = field.label;
        node.addControl(key, control);
      }
    }

    node.position = [instance.position.x, instance.position.y];
    return node;
  };

  const applyMidiMapRangeConstraints = async (
    state: { nodes: NodeInstance[]; connections: EngineConnection[] },
    areaPlugin: AnyAreaPlugin | null | undefined,
    nodeMap: Map<string, any>
  ) => {
    if (!areaPlugin) return;

    const byId = new Map(state.nodes.map((n) => [String(n.id), n]));

    for (const node of state.nodes) {
      if (node.type !== 'midi-map') continue;

      const def = nodeRegistry.get(node.type);
      const minField = def?.configSchema?.find((f) => f.key === 'min');
      const maxField = def?.configSchema?.find((f) => f.key === 'max');

      const baseMinCandidates = [minField?.min, maxField?.min].filter(isFiniteNumber);
      const baseMaxCandidates = [minField?.max, maxField?.max].filter(isFiniteNumber);
      const baseMin = baseMinCandidates.length > 0 ? Math.max(...baseMinCandidates) : undefined;
      const baseMax = baseMaxCandidates.length > 0 ? Math.min(...baseMaxCandidates) : undefined;

      const conns = state.connections.filter(
        (c) => String(c.sourceNodeId) === String(node.id) && String(c.sourcePortId) === 'out'
      );

      let downMin: number | undefined;
      let downMax: number | undefined;

      for (const c of conns) {
        const target = byId.get(String(c.targetNodeId));
        const targetDef = target ? nodeRegistry.get(target.type) : null;
        const port = targetDef?.inputs?.find((p) => p.id === c.targetPortId);
        if (!port || port.type !== 'number') continue;

        if (isFiniteNumber(port.min)) {
          downMin = downMin === undefined ? port.min : Math.max(downMin, port.min);
        }
        if (isFiniteNumber(port.max)) {
          downMax = downMax === undefined ? port.max : Math.min(downMax, port.max);
        }
      }

      if (downMin !== undefined && downMax !== undefined && downMax < downMin) {
        downMin = undefined;
        downMax = undefined;
      }

      const nextMinLimit =
        baseMin !== undefined && downMin !== undefined ? Math.max(baseMin, downMin) : (baseMin ?? downMin);
      const nextMaxLimit =
        baseMax !== undefined && downMax !== undefined ? Math.min(baseMax, downMax) : (baseMax ?? downMax);

      const reteNode = nodeMap.get(String(node.id));
      const minCtrl: any = reteNode?.controls?.min;
      const maxCtrl: any = reteNode?.controls?.max;
      let needsNodeUpdate = false;

      if (minCtrl) {
        if (minCtrl.min !== nextMinLimit) {
          minCtrl.min = nextMinLimit;
          needsNodeUpdate = true;
        }
        if (minCtrl.max !== nextMaxLimit) {
          minCtrl.max = nextMaxLimit;
          needsNodeUpdate = true;
        }
      }

      if (maxCtrl) {
        if (maxCtrl.min !== nextMinLimit) {
          maxCtrl.min = nextMinLimit;
          needsNodeUpdate = true;
        }
        if (maxCtrl.max !== nextMaxLimit) {
          maxCtrl.max = nextMaxLimit;
          needsNodeUpdate = true;
        }
      }

      const rawMin = Number(node.config?.min ?? minField?.defaultValue ?? 0);
      const rawMax = Number(node.config?.max ?? maxField?.defaultValue ?? 1);
      const effectiveRawMin = Number.isFinite(rawMin) ? rawMin : 0;
      const effectiveRawMax = Number.isFinite(rawMax) ? rawMax : 1;
      const clampedMin = clampNumber(effectiveRawMin, nextMinLimit, nextMaxLimit);
      const clampedMax = clampNumber(effectiveRawMax, nextMinLimit, nextMaxLimit);

      const updates: Record<string, number> = {};
      if (clampedMin !== effectiveRawMin) updates.min = clampedMin;
      if (clampedMax !== effectiveRawMax) updates.max = clampedMax;
      if (Object.keys(updates).length > 0) {
        nodeEngine.updateNodeConfig(String(node.id), updates);
        if (minCtrl) minCtrl.value = clampedMin;
        if (maxCtrl) maxCtrl.value = clampedMax;
        needsNodeUpdate = true;
      }

      if (needsNodeUpdate) await areaPlugin.update('node', String(node.id));
    }
  };

  const isCompatible = (sourceType: PortType, targetType: PortType) => {
    if (sourceType === 'audio' || targetType === 'audio') return sourceType === 'audio' && targetType === 'audio';
    if (sourceType === 'image' || targetType === 'image') return sourceType === 'image' && targetType === 'image';
    if (sourceType === 'video' || targetType === 'video') return sourceType === 'video' && targetType === 'video';
    return sourceType === 'any' || targetType === 'any' || sourceType === targetType;
  };

  const getPortDefForSocket = (socket: { nodeId: string; side: 'input' | 'output'; key: string }): NodePort | null => {
    const instance = nodeEngine.getNode?.(socket.nodeId) as NodeInstance | undefined;
    if (!instance) return null;
    const def = nodeRegistry.get(instance.type);
    if (!def) return null;
    if (socket.side === 'output') return (def.outputs ?? []).find((p) => p.id === socket.key) ?? null;
    return (def.inputs ?? []).find((p) => p.id === socket.key) ?? null;
  };

  const bestMatchingPort = (
    ports: NodePort[],
    requiredType: PortType,
    portSide: 'input' | 'output'
  ): NodePort | null => {
    let best: NodePort | null = null;
    let bestScore = -1;

    for (const port of ports) {
      const portType = (port.type ?? 'any') as PortType;
      const ok =
        portSide === 'input' ? isCompatible(requiredType, portType) : isCompatible(portType, requiredType);
      if (!ok) continue;
      const exact = portType === requiredType ? 2 : 1;
      if (exact > bestScore) {
        bestScore = exact;
        best = port;
      }
    }

    return best;
  };

  const inputAllowsMultiple = (nodeId: string, inputKey: string): boolean => {
    const instance = nodeEngine.getNode?.(nodeId) as NodeInstance | undefined;
    if (!instance) return false;
    const def = nodeRegistry.get(instance.type);
    const port = def?.inputs?.find((p) => p.id === inputKey);
    return port?.kind === 'sink';
  };

  return {
    nodeLabel,
    socketFor,
    buildReteNode,
    applyMidiMapRangeConstraints,
    isCompatible,
    getPortDefForSocket,
    bestMatchingPort,
    inputAllowsMultiple,
  };
}
