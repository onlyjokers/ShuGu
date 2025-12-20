/**
 * Purpose: Import/export actions for node graphs and MIDI templates.
 */
import type { GraphState } from '$lib/nodes/types';
import { exportMidiTemplateFile, instantiateMidiBindings, parseMidiTemplateFile } from '$lib/features/midi/midi-templates';

type FileActionsOptions = {
  nodeEngine: {
    exportGraph: () => GraphState;
    loadGraph: (state: GraphState) => void;
  };
  getImportGraphInput: () => HTMLInputElement | null;
  getImportTemplatesInput: () => HTMLInputElement | null;
  onResetGroups: () => void;
  getViewportCenterGraphPos: () => { x: number; y: number };
};

type NodeGraphFileV1 = { version: 1; kind: 'node-graph'; graph: GraphState };

const downloadJson = (payload: unknown, filename: string) => {
  if (typeof document === 'undefined') return;
  const data = JSON.stringify(payload, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

const parseNodeGraphFile = (payload: unknown): GraphState | null => {
  if (!payload || typeof payload !== 'object') return null;
  const wrapped = payload as any;
  if (wrapped.kind === 'node-graph' && wrapped.version === 1 && wrapped.graph) {
    const graph = wrapped.graph as any;
    if (Array.isArray(graph.nodes) && Array.isArray(graph.connections)) return graph as GraphState;
    return null;
  }
  const raw = payload as any;
  if (Array.isArray(raw.nodes) && Array.isArray(raw.connections)) return raw as GraphState;
  return null;
};

export function createFileActions(opts: FileActionsOptions) {
  const exportGraph = () => {
    const raw = opts.nodeEngine.exportGraph();
    const graph: GraphState = {
      nodes: (raw.nodes ?? []).map((n) => ({ ...n, outputValues: {} })),
      connections: (raw.connections ?? []).map((c) => ({ ...c })),
    };
    const file: NodeGraphFileV1 = { version: 1, kind: 'node-graph', graph };
    downloadJson(file, 'shugu-node-graph.json');
  };

  const importGraph = () => {
    opts.getImportGraphInput()?.click?.();
  };

  const handleImportGraphChange = async (event: Event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      alert('Invalid JSON file.');
      return;
    }

    const graph = parseNodeGraphFile(parsed);
    if (!graph) {
      alert('Unsupported graph format.');
      return;
    }

    const ok = confirm('Load graph from file? This will replace the current graph.');
    if (!ok) return;
    opts.nodeEngine.loadGraph(graph);
    opts.onResetGroups();
  };

  const exportTemplates = () => {
    const file = exportMidiTemplateFile(opts.nodeEngine.exportGraph());
    downloadJson(file, 'shugu-midi-templates.json');
  };

  const importTemplates = () => {
    opts.getImportTemplatesInput()?.click?.();
  };

  const handleImportTemplatesChange = async (event: Event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      alert('Invalid JSON file.');
      return;
    }

    const templates = parseMidiTemplateFile(parsed);
    if (!templates) {
      alert('Unsupported template format (expected version: 1).');
      return;
    }

    const created = instantiateMidiBindings(templates, { anchor: opts.getViewportCenterGraphPos() });
    alert(`Imported ${created.length} template(s).`);
  };

  return {
    exportGraph,
    importGraph,
    handleImportGraphChange,
    exportTemplates,
    importTemplates,
    handleImportTemplatesChange,
  };
}
