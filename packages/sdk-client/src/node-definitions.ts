import type {
    ControlAction,
    ControlPayload,
    SensorPayload,
    SensorType,
} from '@shugu/protocol';
import type { LatestSensorData } from './client-sdk.js';
import type { NodeDefinition } from './node-types.js';
import type { NodeRegistry } from './node-registry.js';

export type NodeCommand = {
    action: ControlAction;
    payload: ControlPayload;
    executeAt?: number;
};

export type ClientSensorMessage = {
    sensorType: SensorType;
    payload: SensorPayload;
    serverTimestamp: number;
    clientTimestamp: number;
};

export type ClientObject = {
    clientId: string;
    sensors?: ClientSensorMessage | null;
};

export type ClientObjectDeps = {
    getClientId: () => string | null;
    getLatestSensor: () => LatestSensorData | null;
    executeCommand: (cmd: NodeCommand) => void;
};

export function registerDefaultNodeDefinitions(registry: NodeRegistry, deps: ClientObjectDeps): void {
    registry.register(createClientObjectNode(deps));
    registry.register(createClientSensorsProcessorNode());
    registry.register(createMathNode());
    registry.register(createLFONode());
    registry.register(createNumberNode());
    registry.register(createFlashlightProcessorNode());
    registry.register(createScreenColorProcessorNode());
    registry.register(createSynthUpdateProcessorNode());
    registry.register(createSceneSwitchProcessorNode());
}

function createClientObjectNode(deps: ClientObjectDeps): NodeDefinition {
    return {
        type: 'client-object',
        label: 'Client',
        category: 'Objects',
        inputs: [{ id: 'in', label: 'In', type: 'command', kind: 'sink' }],
        outputs: [{ id: 'out', label: 'Out', type: 'client' }],
        configSchema: [],
        process: (_inputs, config) => {
            const configured = typeof config.clientId === 'string' ? String(config.clientId) : '';
            const clientId = deps.getClientId() ?? configured;
            const latest = deps.getLatestSensor();
            const sensors: ClientSensorMessage | null = latest
                ? {
                      sensorType: latest.sensorType,
                      payload: latest.payload,
                      serverTimestamp: latest.serverTimestamp,
                      clientTimestamp: latest.clientTimestamp,
                  }
                : null;
            const out: ClientObject = { clientId, sensors };
            return { out };
        },
        onSink: (inputs) => {
            const raw = inputs.in;
            const commands = (Array.isArray(raw) ? raw : [raw]) as unknown[];
            for (const cmd of commands) {
                if (!cmd || typeof cmd !== 'object') continue;
                const action = (cmd as any).action as ControlAction | undefined;
                if (!action) continue;
                deps.executeCommand({
                    action,
                    payload: ((cmd as any).payload ?? {}) as ControlPayload,
                    executeAt: (cmd as any).executeAt as number | undefined,
                });
            }
        },
    };
}

function createClientSensorsProcessorNode(): NodeDefinition {
    return {
        type: 'proc-client-sensors',
        label: 'Client Sensors',
        category: 'Processors',
        inputs: [{ id: 'client', label: 'Client', type: 'client' }],
        outputs: [
            { id: 'accelX', label: 'Accel X', type: 'number' },
            { id: 'accelY', label: 'Accel Y', type: 'number' },
            { id: 'accelZ', label: 'Accel Z', type: 'number' },
            { id: 'gyroA', label: 'Gyro α', type: 'number' },
            { id: 'gyroB', label: 'Gyro β', type: 'number' },
            { id: 'gyroG', label: 'Gyro γ', type: 'number' },
            { id: 'micVol', label: 'Mic Vol', type: 'number' },
            { id: 'micLow', label: 'Mic Low', type: 'number' },
            { id: 'micHigh', label: 'Mic High', type: 'number' },
            { id: 'micBpm', label: 'Mic BPM', type: 'number' },
        ],
        configSchema: [],
        process: (inputs) => {
            const client = inputs.client as any;
            const msg = client?.sensors as any;

            const out = {
                accelX: 0,
                accelY: 0,
                accelZ: 0,
                gyroA: 0,
                gyroB: 0,
                gyroG: 0,
                micVol: 0,
                micLow: 0,
                micHigh: 0,
                micBpm: 0,
            };

            if (!msg || typeof msg !== 'object') return out;

            const payload = msg.payload ?? {};
            switch (msg.sensorType) {
                case 'accel':
                    out.accelX = Number(payload.x ?? 0);
                    out.accelY = Number(payload.y ?? 0);
                    out.accelZ = Number(payload.z ?? 0);
                    break;
                case 'gyro':
                case 'orientation':
                    out.gyroA = Number(payload.alpha ?? 0);
                    out.gyroB = Number(payload.beta ?? 0);
                    out.gyroG = Number(payload.gamma ?? 0);
                    break;
                case 'mic':
                    out.micVol = Number(payload.volume ?? 0);
                    out.micLow = Number(payload.lowEnergy ?? 0);
                    out.micHigh = Number(payload.highEnergy ?? 0);
                    out.micBpm = Number(payload.bpm ?? 0);
                    break;
            }

            return out;
        },
    };
}

function createMathNode(): NodeDefinition {
    return {
        type: 'math',
        label: 'Math',
        category: 'Math',
        inputs: [
            { id: 'a', label: 'A', type: 'number', defaultValue: 0 },
            { id: 'b', label: 'B', type: 'number', defaultValue: 0 },
        ],
        outputs: [{ id: 'result', label: 'Result', type: 'number' }],
        configSchema: [
            {
                key: 'operation',
                label: 'Operation',
                type: 'select',
                defaultValue: '+',
                options: [
                    { value: '+', label: 'Add (+)' },
                    { value: '-', label: 'Subtract (-)' },
                    { value: '*', label: 'Multiply (×)' },
                    { value: '/', label: 'Divide (÷)' },
                    { value: 'min', label: 'Min' },
                    { value: 'max', label: 'Max' },
                    { value: 'mod', label: 'Modulo (%)' },
                    { value: 'pow', label: 'Power (^)' },
                ],
            },
        ],
        process: (inputs, config) => {
            const a = (inputs.a as number) ?? 0;
            const b = (inputs.b as number) ?? 0;
            const op = String(config.operation ?? '+');

            let result: number;
            switch (op) {
                case '+':
                    result = a + b;
                    break;
                case '-':
                    result = a - b;
                    break;
                case '*':
                    result = a * b;
                    break;
                case '/':
                    result = b !== 0 ? a / b : 0;
                    break;
                case 'min':
                    result = Math.min(a, b);
                    break;
                case 'max':
                    result = Math.max(a, b);
                    break;
                case 'mod':
                    result = b !== 0 ? a % b : 0;
                    break;
                case 'pow':
                    result = Math.pow(a, b);
                    break;
                default:
                    result = a + b;
            }

            return { result };
        },
    };
}

function createLFONode(): NodeDefinition {
    return {
        type: 'lfo',
        label: 'LFO',
        category: 'Generators',
        inputs: [
            { id: 'frequency', label: 'Freq (Hz)', type: 'number', defaultValue: 1 },
            { id: 'amplitude', label: 'Amplitude', type: 'number', defaultValue: 1 },
            { id: 'offset', label: 'Offset', type: 'number', defaultValue: 0 },
        ],
        outputs: [{ id: 'value', label: 'Value', type: 'number' }],
        configSchema: [
            {
                key: 'waveform',
                label: 'Waveform',
                type: 'select',
                defaultValue: 'sine',
                options: [
                    { value: 'sine', label: 'Sine' },
                    { value: 'square', label: 'Square' },
                    { value: 'triangle', label: 'Triangle' },
                    { value: 'sawtooth', label: 'Sawtooth' },
                ],
            },
        ],
        process: (inputs, config, context) => {
            const frequency = (inputs.frequency as number) ?? 1;
            const amplitude = (inputs.amplitude as number) ?? 1;
            const offset = (inputs.offset as number) ?? 0;
            const waveform = String(config.waveform ?? 'sine');

            const phase = (context.time / 1000) * frequency * 2 * Math.PI;

            let normalized: number;
            switch (waveform) {
                case 'sine':
                    normalized = (Math.sin(phase) + 1) / 2;
                    break;
                case 'square':
                    normalized = Math.sin(phase) >= 0 ? 1 : 0;
                    break;
                case 'triangle':
                    normalized = Math.abs(((context.time / 1000) * frequency * 2) % 2 - 1);
                    break;
                case 'sawtooth':
                    normalized = ((context.time / 1000) * frequency) % 1;
                    break;
                default:
                    normalized = (Math.sin(phase) + 1) / 2;
            }

            const value = offset + normalized * amplitude;
            return { value };
        },
    };
}

function createNumberNode(): NodeDefinition {
    return {
        type: 'number',
        label: 'Number',
        category: 'Values',
        inputs: [],
        outputs: [{ id: 'value', label: 'Value', type: 'number' }],
        configSchema: [{ key: 'value', label: 'Value', type: 'number', defaultValue: 0 }],
        process: (_inputs, config) => ({ value: (config.value as number) ?? 0 }),
    };
}

const FLASHLIGHT_MODE_OPTIONS = [
    { value: 'off', label: 'Off' },
    { value: 'on', label: 'On' },
    { value: 'blink', label: 'Blink' },
] as const satisfies { value: string; label: string }[];

function createFlashlightProcessorNode(): NodeDefinition {
    return {
        type: 'proc-flashlight',
        label: 'Flashlight',
        category: 'Processors',
        inputs: [
            { id: 'client', label: 'Client', type: 'client' },
            { id: 'mode', label: 'Mode', type: 'fuzzy' },
            { id: 'frequencyHz', label: 'Freq', type: 'number' },
            { id: 'dutyCycle', label: 'Duty', type: 'number' },
        ],
        outputs: [{ id: 'cmd', label: 'Cmd', type: 'command' }],
        configSchema: [
            {
                key: 'mode',
                label: 'Mode',
                type: 'select',
                defaultValue: 'blink',
                options: FLASHLIGHT_MODE_OPTIONS as unknown as { value: string; label: string }[],
            },
            { key: 'frequencyHz', label: 'Frequency (Hz)', type: 'number', defaultValue: 2 },
            { key: 'dutyCycle', label: 'Duty Cycle', type: 'number', defaultValue: 0.5 },
        ],
        process: (inputs, config) => {
            const client = inputs.client as any;
            if (!client?.clientId) return { cmd: null };

            const fallbackMode = String(config.mode ?? 'blink');
            const mode = (() => {
                const v = inputs.mode;
                if (typeof v !== 'number' || !Number.isFinite(v)) return fallbackMode;
                const options = FLASHLIGHT_MODE_OPTIONS.map((o) => o.value);
                const clamped = Math.max(0, Math.min(1, v));
                const idx = Math.min(options.length - 1, Math.floor(clamped * options.length));
                return options[idx] ?? fallbackMode;
            })();

            if (mode === 'blink') {
                const freq =
                    typeof inputs.frequencyHz === 'number'
                        ? (inputs.frequencyHz as number)
                        : Number(config.frequencyHz ?? 2);
                const duty =
                    typeof inputs.dutyCycle === 'number'
                        ? (inputs.dutyCycle as number)
                        : Number(config.dutyCycle ?? 0.5);
                return {
                    cmd: {
                        action: 'flashlight',
                        payload: { mode: 'blink', frequency: freq, dutyCycle: duty },
                    },
                };
            }

            return { cmd: { action: 'flashlight', payload: { mode } } };
        },
    };
}

const SCREEN_WAVEFORM_OPTIONS = [
    { value: 'sine', label: 'Sine' },
    { value: 'square', label: 'Square' },
    { value: 'triangle', label: 'Triangle' },
    { value: 'sawtooth', label: 'Sawtooth' },
] as const satisfies { value: string; label: string }[];

function createScreenColorProcessorNode(): NodeDefinition {
    return {
        type: 'proc-screen-color',
        label: 'Screen Color',
        category: 'Processors',
        inputs: [
            { id: 'client', label: 'Client', type: 'client' },
            { id: 'primary', label: 'Primary', type: 'color' },
            { id: 'secondary', label: 'Secondary', type: 'color' },
            { id: 'waveform', label: 'Wave', type: 'fuzzy' },
            { id: 'frequencyHz', label: 'Freq', type: 'number' },
            { id: 'maxOpacity', label: 'Max', type: 'number' },
            { id: 'minOpacity', label: 'Min', type: 'number' },
        ],
        outputs: [{ id: 'cmd', label: 'Cmd', type: 'command' }],
        configSchema: [
            { key: 'primary', label: 'Primary', type: 'string', defaultValue: '#6366f1' },
            { key: 'secondary', label: 'Secondary', type: 'string', defaultValue: '#ffffff' },
            { key: 'maxOpacity', label: 'Max Opacity', type: 'number', defaultValue: 1 },
            { key: 'minOpacity', label: 'Min Opacity', type: 'number', defaultValue: 0 },
            {
                key: 'waveform',
                label: 'Waveform',
                type: 'select',
                defaultValue: 'sine',
                options: SCREEN_WAVEFORM_OPTIONS as unknown as { value: string; label: string }[],
            },
            { key: 'frequencyHz', label: 'Frequency (Hz)', type: 'number', defaultValue: 1.5 },
        ],
        process: (inputs, config) => {
            const client = inputs.client as any;
            if (!client?.clientId) return { cmd: null };

            const primary =
                typeof inputs.primary === 'string' && inputs.primary
                    ? String(inputs.primary)
                    : String(config.primary ?? '#6366f1');
            const secondary =
                typeof inputs.secondary === 'string' && inputs.secondary
                    ? String(inputs.secondary)
                    : String(config.secondary ?? '#ffffff');
            const maxOpacity =
                typeof inputs.maxOpacity === 'number'
                    ? (inputs.maxOpacity as number)
                    : Number(config.maxOpacity ?? 1);
            const minOpacity =
                typeof inputs.minOpacity === 'number'
                    ? (inputs.minOpacity as number)
                    : Number(config.minOpacity ?? 0);
            const fallbackWaveform = String(config.waveform ?? 'sine');
            const waveform = (() => {
                const v = inputs.waveform;
                if (typeof v !== 'number' || !Number.isFinite(v)) return fallbackWaveform;
                const options = SCREEN_WAVEFORM_OPTIONS.map((o) => o.value);
                const clamped = Math.max(0, Math.min(1, v));
                const idx = Math.min(options.length - 1, Math.floor(clamped * options.length));
                return options[idx] ?? fallbackWaveform;
            })();
            const frequencyHz =
                typeof inputs.frequencyHz === 'number'
                    ? (inputs.frequencyHz as number)
                    : Number(config.frequencyHz ?? 1.5);

            return {
                cmd: {
                    action: 'screenColor',
                    payload: {
                        mode: 'modulate',
                        color: primary,
                        secondaryColor: secondary,
                        opacity: maxOpacity,
                        minOpacity,
                        maxOpacity,
                        frequencyHz,
                        waveform,
                    },
                },
            };
        },
    };
}

const SYNTH_WAVEFORM_OPTIONS = [
    { value: 'square', label: 'Square' },
    { value: 'sine', label: 'Sine' },
    { value: 'triangle', label: 'Triangle' },
    { value: 'sawtooth', label: 'Sawtooth' },
] as const satisfies { value: string; label: string }[];

function createSynthUpdateProcessorNode(): NodeDefinition {
    return {
        type: 'proc-synth-update',
        label: 'Synth (Update)',
        category: 'Processors',
        inputs: [
            { id: 'client', label: 'Client', type: 'client' },
            { id: 'waveform', label: 'Wave', type: 'fuzzy' },
            { id: 'frequency', label: 'Freq', type: 'number' },
            { id: 'volume', label: 'Vol', type: 'number' },
            { id: 'modDepth', label: 'Depth', type: 'number' },
            { id: 'modFrequency', label: 'Rate', type: 'number' },
            { id: 'durationMs', label: 'Dur', type: 'number' },
        ],
        outputs: [{ id: 'cmd', label: 'Cmd', type: 'command' }],
        configSchema: [
            { key: 'frequency', label: 'Freq (Hz)', type: 'number', defaultValue: 180 },
            { key: 'volume', label: 'Volume', type: 'number', defaultValue: 0.7 },
            {
                key: 'waveform',
                label: 'Waveform',
                type: 'select',
                defaultValue: 'square',
                options: SYNTH_WAVEFORM_OPTIONS as unknown as { value: string; label: string }[],
            },
            { key: 'modDepth', label: 'Wobble Depth', type: 'number', defaultValue: 0 },
            { key: 'modFrequency', label: 'Wobble Rate (Hz)', type: 'number', defaultValue: 12 },
            { key: 'durationMs', label: 'Dur (ms)', type: 'number', defaultValue: 200 },
        ],
        process: (inputs, config) => {
            const client = inputs.client as any;
            if (!client?.clientId) return { cmd: null };

            const frequency =
                typeof inputs.frequency === 'number'
                    ? (inputs.frequency as number)
                    : Number(config.frequency ?? 180);
            const volume =
                typeof inputs.volume === 'number'
                    ? (inputs.volume as number)
                    : Number(config.volume ?? 0.7);
            const depthRaw =
                typeof inputs.modDepth === 'number'
                    ? (inputs.modDepth as number)
                    : Number(config.modDepth ?? 0);
            const depth = Math.max(0, Math.min(1, depthRaw));
            const modFrequency =
                typeof inputs.modFrequency === 'number'
                    ? (inputs.modFrequency as number)
                    : Number(config.modFrequency ?? 12);
            const durationMs =
                typeof inputs.durationMs === 'number'
                    ? (inputs.durationMs as number)
                    : Number(config.durationMs ?? 200);

            const fallbackWaveform = String(config.waveform ?? 'square');
            const waveform = (() => {
                const v = inputs.waveform;
                if (typeof v !== 'number' || !Number.isFinite(v)) return fallbackWaveform;
                const options = SYNTH_WAVEFORM_OPTIONS.map((o) => o.value);
                const clamped = Math.max(0, Math.min(1, v));
                const idx = Math.min(options.length - 1, Math.floor(clamped * options.length));
                return options[idx] ?? fallbackWaveform;
            })();

            return {
                cmd: {
                    action: 'modulateSoundUpdate',
                    payload: {
                        frequency,
                        volume: Math.max(0, Math.min(1, volume)),
                        waveform,
                        modDepth: depth > 0 ? depth : undefined,
                        modFrequency: depth > 0 ? modFrequency : undefined,
                        durationMs,
                    },
                },
            };
        },
    };
}

function createSceneSwitchProcessorNode(): NodeDefinition {
    return {
        type: 'proc-scene-switch',
        label: 'Visual Scene',
        category: 'Processors',
        inputs: [
            { id: 'client', label: 'Client', type: 'client' },
            { id: 'index', label: 'Index', type: 'number' },
        ],
        outputs: [{ id: 'cmd', label: 'Cmd', type: 'command' }],
        configSchema: [
            {
                key: 'sceneId',
                label: 'Scene',
                type: 'select',
                defaultValue: 'box-scene',
                options: [
                    { value: 'box-scene', label: '3D Box' },
                    { value: 'mel-scene', label: 'Mel Spectrogram' },
                ],
            },
        ],
        process: (inputs, config) => {
            const client = inputs.client as any;
            if (!client?.clientId) return { cmd: null };

            const sceneId =
                typeof inputs.index === 'number'
                    ? (inputs.index as number) >= 0.5
                        ? 'mel-scene'
                        : 'box-scene'
                    : String(config.sceneId ?? 'box-scene');
            return { cmd: { action: 'visualSceneSwitch', payload: { sceneId } } };
        },
    };
}

