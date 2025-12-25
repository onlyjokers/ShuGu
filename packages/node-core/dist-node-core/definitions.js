const clientSelectionStateByNodeId = new Map();
function hashStringDjb2(value) {
    let hash = 5381;
    for (let i = 0; i < value.length; i += 1) {
        hash = ((hash << 5) + hash + value.charCodeAt(i)) >>> 0;
    }
    return hash >>> 0;
}
function clampInt(value, fallback, min, max) {
    const n = typeof value === 'string' ? Number(value) : Number(value);
    if (!Number.isFinite(n))
        return fallback;
    const next = Math.floor(n);
    return Math.max(min, Math.min(max, next));
}
function buildStableRandomOrder(nodeId, clients) {
    const keyed = clients.map((id) => ({ id, score: hashStringDjb2(`${nodeId}|${id}`) }));
    keyed.sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
    return keyed.map((k) => k.id);
}
function selectClientIdsForNode(nodeId, clients, options) {
    const total = clients.length;
    if (total === 0)
        return { index: 1, selectedIds: [] };
    const index = clampInt(options.index, 1, 1, total);
    const range = clampInt(options.range, 1, 1, total);
    const random = Boolean(options.random);
    const availableKey = clients.join('|');
    const prev = clientSelectionStateByNodeId.get(nodeId);
    const needRebuild = !prev ||
        prev.availableKey !== availableKey ||
        prev.random !== random ||
        prev.stableRandomOrder.length !== total;
    const state = needRebuild
        ? {
            availableKey,
            random,
            stableRandomOrder: random ? buildStableRandomOrder(nodeId, clients) : clients.slice(),
        }
        : prev;
    if (needRebuild)
        clientSelectionStateByNodeId.set(nodeId, state);
    const ordered = state.random ? state.stableRandomOrder : clients;
    const start = index - 1;
    const selected = [];
    for (let i = 0; i < range; i += 1) {
        selected.push(ordered[(start + i) % total]);
    }
    return { index, selectedIds: selected };
}
export function registerDefaultNodeDefinitions(registry, deps) {
    registry.register(createClientObjectNode(deps));
    registry.register(createCmdAggregatorNode());
    registry.register(createClientSensorsProcessorNode());
    registry.register(createMathNode());
    registry.register(createLogicAddNode());
    registry.register(createLogicMultipleNode());
    registry.register(createLogicSubtractNode());
    registry.register(createLogicDivideNode());
    registry.register(createLogicIfNode());
    registry.register(createLogicForNode());
    registry.register(createLogicSleepNode());
    registry.register(createNumberNode());
    registry.register(createStringNode());
    registry.register(createBoolNode());
    registry.register(createNumberStabilizerNode());
    // Tone.js audio nodes (client runtime overrides these definitions).
    registry.register(createToneLFONode());
    registry.register(createToneOscNode());
    registry.register(createToneDelayNode());
    registry.register(createToneResonatorNode());
    registry.register(createTonePitchNode());
    registry.register(createToneReverbNode());
    registry.register(createToneGranularNode());
    // Media playback helpers.
    registry.register(createLoadAudioFromAssetsNode());
    registry.register(createLoadAudioFromLocalNode());
    registry.register(createLoadImageFromAssetsNode());
    registry.register(createLoadImageFromLocalNode());
    registry.register(createLoadVideoFromAssetsNode());
    registry.register(createLoadVideoFromLocalNode());
    registry.register(createPlayMediaNode());
    // Patch root sinks (Max/MSP style).
    registry.register(createAudioOutNode());
    registry.register(createImageOutNode(deps));
    registry.register(createVideoOutNode(deps));
    registry.register(createFlashlightProcessorNode());
    registry.register(createScreenColorProcessorNode());
    registry.register(createSynthUpdateProcessorNode());
    registry.register(createSceneSwitchProcessorNode());
}
function createLoadAudioFromAssetsNode() {
    return {
        type: 'load-audio-from-assets',
        label: 'Load Audio From Remote',
        category: 'Assets',
        inputs: [
            { id: 'startSec', label: 'Start (s)', type: 'number', defaultValue: 0, min: 0, step: 0.01 },
            { id: 'endSec', label: 'End (s)', type: 'number', defaultValue: -1, min: -1, step: 0.01 },
            {
                id: 'cursorSec',
                label: 'Cursor (s)',
                type: 'number',
                defaultValue: -1,
                min: -1,
                step: 0.01,
            },
            { id: 'loop', label: 'Loop', type: 'boolean', defaultValue: false },
            { id: 'play', label: 'Play', type: 'boolean', defaultValue: true },
            { id: 'reverse', label: 'Reverse', type: 'boolean', defaultValue: false },
            { id: 'playbackRate', label: 'Rate', type: 'number', defaultValue: 1 },
            { id: 'detune', label: 'Detune', type: 'number', defaultValue: 0 },
            { id: 'bus', label: 'Bus', type: 'string' },
        ],
        outputs: [
            { id: 'ref', label: 'Audio Out', type: 'audio', kind: 'sink' },
            { id: 'ended', label: 'Ended', type: 'boolean' },
        ],
        configSchema: [
            {
                key: 'assetId',
                label: 'Audio Asset',
                type: 'asset-picker',
                assetKind: 'audio',
                defaultValue: '',
            },
            { key: 'playbackRate', label: 'Rate', type: 'number', defaultValue: 1 },
            { key: 'detune', label: 'Detune', type: 'number', defaultValue: 0 },
            { key: 'bus', label: 'Bus', type: 'string', defaultValue: 'main' },
            {
                key: 'timeline',
                label: 'Timeline',
                type: 'time-range',
                defaultValue: { startSec: 0, endSec: -1, cursorSec: -1 },
                min: 0,
                step: 0.01,
            },
        ],
        process: (inputs, config) => {
            const assetId = typeof config.assetId === 'string' ? config.assetId.trim() : '';
            const playRaw = inputs.play;
            const play = typeof playRaw === 'number' ? playRaw >= 0.5 : Boolean(playRaw);
            // Manager-side placeholder: the actual audio playback is implemented on the client runtime.
            // Return a simple gate value so downstream nodes can reflect play/pause state.
            return { ref: assetId && play ? 1 : 0, ended: false };
        },
    };
}
function createLoadAudioFromLocalNode() {
    return {
        type: 'load-audio-from-local',
        label: 'Load Audio From Local(Display only)',
        category: 'Assets',
        inputs: [
            { id: 'asset', label: 'Asset', type: 'string', defaultValue: '' },
            { id: 'startSec', label: 'Start (s)', type: 'number', defaultValue: 0, min: 0, step: 0.01 },
            { id: 'endSec', label: 'End (s)', type: 'number', defaultValue: -1, min: -1, step: 0.01 },
            {
                id: 'cursorSec',
                label: 'Cursor (s)',
                type: 'number',
                defaultValue: -1,
                min: -1,
                step: 0.01,
            },
            { id: 'loop', label: 'Loop', type: 'boolean', defaultValue: false },
            { id: 'play', label: 'Play', type: 'boolean', defaultValue: true },
            { id: 'reverse', label: 'Reverse', type: 'boolean', defaultValue: false },
            { id: 'playbackRate', label: 'Rate', type: 'number', defaultValue: 1 },
            { id: 'detune', label: 'Detune', type: 'number', defaultValue: 0 },
            { id: 'bus', label: 'Bus', type: 'string' },
        ],
        outputs: [
            { id: 'ref', label: 'Audio Out', type: 'audio', kind: 'sink' },
            { id: 'ended', label: 'Ended', type: 'boolean' },
        ],
        configSchema: [
            { key: 'playbackRate', label: 'Rate', type: 'number', defaultValue: 1 },
            { key: 'detune', label: 'Detune', type: 'number', defaultValue: 0 },
            { key: 'bus', label: 'Bus', type: 'string', defaultValue: 'main' },
            {
                key: 'timeline',
                label: 'Timeline',
                type: 'time-range',
                defaultValue: { startSec: 0, endSec: -1, cursorSec: -1 },
                min: 0,
                step: 0.01,
            },
        ],
        process: (inputs) => {
            const asset = typeof inputs.asset === 'string' ? inputs.asset.trim() : '';
            const playRaw = inputs.play;
            const play = typeof playRaw === 'number' ? playRaw >= 0.5 : Boolean(playRaw);
            // Client runtime may override this for real playback. Manager-side stays as a simple gate.
            return { ref: asset && play ? 1 : 0, ended: false };
        },
    };
}
function createLoadImageFromAssetsNode() {
    return {
        type: 'load-image-from-assets',
        label: 'Load Image From Remote',
        category: 'Assets',
        inputs: [],
        outputs: [{ id: 'ref', label: 'Image Out', type: 'image', kind: 'sink' }],
        configSchema: [
            {
                key: 'assetId',
                label: 'Image Asset',
                type: 'asset-picker',
                assetKind: 'image',
                defaultValue: '',
            },
            {
                key: 'fit',
                label: 'Fit',
                type: 'select',
                defaultValue: 'contain',
                options: [
                    { value: 'contain', label: 'Contain' },
                    { value: 'cover', label: 'Cover' },
                    { value: 'fill', label: 'Fill' },
                ],
            },
        ],
        process: (_inputs, config) => {
            const assetId = typeof config.assetId === 'string' ? config.assetId.trim() : '';
            const fitRaw = typeof config.fit === 'string' ? config.fit.trim().toLowerCase() : '';
            const fit = fitRaw === 'cover' || fitRaw === 'fill' ? fitRaw : 'contain';
            const fitHash = fit !== 'contain' ? `#fit=${fit}` : '';
            return { ref: assetId ? `asset:${assetId}${fitHash}` : '' };
        },
    };
}
function createLoadImageFromLocalNode() {
    return {
        type: 'load-image-from-local',
        label: 'Load Image From Local(Display only)',
        category: 'Assets',
        inputs: [{ id: 'asset', label: 'Asset', type: 'string', defaultValue: '' }],
        outputs: [{ id: 'ref', label: 'Image Out', type: 'image', kind: 'sink' }],
        configSchema: [
            {
                key: 'fit',
                label: 'Fit',
                type: 'select',
                defaultValue: 'contain',
                options: [
                    { value: 'contain', label: 'Contain' },
                    { value: 'cover', label: 'Cover' },
                    { value: 'fill', label: 'Fill' },
                ],
            },
        ],
        process: (inputs, config) => {
            const baseUrl = typeof inputs.asset === 'string' ? inputs.asset.trim() : '';
            const fitRaw = typeof config.fit === 'string' ? config.fit.trim().toLowerCase() : '';
            const fit = fitRaw === 'cover' || fitRaw === 'fill' ? fitRaw : 'contain';
            const fitHash = fit !== 'contain' ? `#fit=${fit}` : '';
            if (!baseUrl)
                return { ref: '' };
            if (!fitHash)
                return { ref: baseUrl };
            const hashIndex = baseUrl.indexOf('#');
            if (hashIndex < 0)
                return { ref: `${baseUrl}${fitHash}` };
            const withoutHash = baseUrl.slice(0, hashIndex);
            const params = new URLSearchParams(baseUrl.slice(hashIndex + 1));
            params.set('fit', fit);
            return { ref: `${withoutHash}#${params.toString()}` };
        },
    };
}
const loadVideoTimelineState = new Map();
function createLoadVideoFromAssetsNode() {
    return {
        type: 'load-video-from-assets',
        label: 'Load Video From Remote',
        category: 'Assets',
        inputs: [
            { id: 'startSec', label: 'Start (s)', type: 'number', defaultValue: 0, min: 0, step: 0.01 },
            { id: 'endSec', label: 'End (s)', type: 'number', defaultValue: -1, min: -1, step: 0.01 },
            {
                id: 'cursorSec',
                label: 'Cursor (s)',
                type: 'number',
                defaultValue: -1,
                min: -1,
                step: 0.01,
            },
            { id: 'loop', label: 'Loop', type: 'boolean', defaultValue: false },
            { id: 'play', label: 'Play', type: 'boolean', defaultValue: true },
            { id: 'reverse', label: 'Reverse', type: 'boolean', defaultValue: false },
            { id: 'muted', label: 'Mute', type: 'boolean', defaultValue: true },
        ],
        outputs: [
            { id: 'ref', label: 'Video Out', type: 'video', kind: 'sink' },
            { id: 'ended', label: 'Ended', type: 'boolean' },
        ],
        configSchema: [
            {
                key: 'assetId',
                label: 'Video Asset',
                type: 'asset-picker',
                assetKind: 'video',
                defaultValue: '',
            },
            {
                key: 'timeline',
                label: 'Timeline',
                type: 'time-range',
                defaultValue: { startSec: 0, endSec: -1, cursorSec: -1 },
                min: 0,
                step: 0.01,
            },
            {
                key: 'fit',
                label: 'Fit',
                type: 'select',
                defaultValue: 'contain',
                options: [
                    { value: 'contain', label: 'Contain' },
                    { value: 'cover', label: 'Cover' },
                    { value: 'fill', label: 'Fill' },
                ],
            },
        ],
        process: (inputs, config, context) => {
            const assetId = typeof config.assetId === 'string' ? config.assetId.trim() : '';
            const fitRaw = typeof config.fit === 'string' ? config.fit.trim().toLowerCase() : '';
            const fit = fitRaw === 'cover' || fitRaw === 'fill' ? fitRaw : 'contain';
            const startSecRaw = inputs.startSec;
            const endSecRaw = inputs.endSec;
            const cursorSecRaw = inputs.cursorSec;
            const startSec = typeof startSecRaw === 'number' && Number.isFinite(startSecRaw) ? startSecRaw : 0;
            const endSec = typeof endSecRaw === 'number' && Number.isFinite(endSecRaw) ? endSecRaw : -1;
            const cursorSec = typeof cursorSecRaw === 'number' && Number.isFinite(cursorSecRaw) ? cursorSecRaw : -1;
            const loopRaw = inputs.loop;
            const loop = typeof loopRaw === 'number' ? loopRaw >= 0.5 : Boolean(loopRaw);
            const playRaw = inputs.play;
            const play = typeof playRaw === 'number' ? playRaw >= 0.5 : Boolean(playRaw);
            const reverseRaw = inputs.reverse;
            const reverse = typeof reverseRaw === 'number' ? reverseRaw >= 0.5 : Boolean(reverseRaw);
            const mutedRaw = inputs.muted;
            const muted = typeof mutedRaw === 'number' ? mutedRaw >= 0.5 : Boolean(mutedRaw);
            const startClamped = Math.max(0, startSec);
            const endClamped = endSec >= 0 ? Math.max(startClamped, endSec) : -1;
            const tValue = endClamped >= 0 ? `${startClamped},${endClamped}` : `${startClamped},`;
            const cursorClamped = cursorSec >= 0 ? Math.max(startClamped, cursorSec) : -1;
            const cursorForPlayback = cursorClamped >= 0
                ? endClamped >= 0
                    ? Math.min(endClamped, cursorClamped)
                    : cursorClamped
                : null;
            const positionParam = cursorForPlayback !== null ? `&p=${cursorForPlayback}` : '';
            const nodeParam = context?.nodeId ? `&node=${encodeURIComponent(String(context.nodeId))}` : '';
            const fitParam = fit !== 'contain' ? `&fit=${fit}` : '';
            const refBase = assetId
                ? `asset:${assetId}#t=${tValue}&loop=${loop ? 1 : 0}&play=${play ? 1 : 0}&rev=${reverse ? 1 : 0}&muted=${muted ? 1 : 0}${positionParam}${nodeParam}`
                : '';
            const refWithFit = fitParam ? `${refBase}${fitParam}` : refBase;
            if (!assetId) {
                loadVideoTimelineState.delete(context.nodeId);
                return { ref: '', ended: false };
            }
            const qSec = (value) => Math.round(value * 100) / 100;
            const signature = [
                assetId,
                qSec(startClamped),
                qSec(endClamped),
                qSec(cursorForPlayback ?? -1),
                loop ? 1 : 0,
                reverse ? 1 : 0,
            ].join('|');
            const prevState = loadVideoTimelineState.get(context.nodeId);
            const state = prevState ?? {
                signature: '',
                lastPlay: false,
                accumulatedMs: 0,
                ended: false,
                endedPulsePending: false,
            };
            const settingsChanged = signature !== state.signature;
            if (settingsChanged) {
                state.signature = signature;
                state.accumulatedMs = 0;
                state.ended = false;
                state.endedPulsePending = false;
            }
            const playActive = play;
            const playRising = playActive && !state.lastPlay;
            if (state.ended && playRising) {
                state.accumulatedMs = 0;
                state.ended = false;
                state.endedPulsePending = false;
            }
            let durationSec = null;
            if (!loop) {
                if (reverse) {
                    const startPos = cursorForPlayback ?? (endClamped >= 0 ? endClamped : startClamped);
                    durationSec = Math.max(0, startPos - startClamped);
                }
                else if (endClamped >= 0) {
                    const startPos = cursorForPlayback ?? startClamped;
                    durationSec = Math.max(0, endClamped - startPos);
                }
            }
            const dtMs = typeof context.deltaTime === 'number' && Number.isFinite(context.deltaTime)
                ? Math.max(0, context.deltaTime)
                : 0;
            if (!loop && durationSec !== null && playActive && !state.ended) {
                if (durationSec <= 0) {
                    state.ended = true;
                    state.endedPulsePending = true;
                }
                else if (state.lastPlay) {
                    state.accumulatedMs += dtMs;
                    if (state.accumulatedMs >= durationSec * 1000) {
                        state.accumulatedMs = durationSec * 1000;
                        state.ended = true;
                        state.endedPulsePending = true;
                    }
                }
            }
            const endedPulse = state.endedPulsePending;
            state.endedPulsePending = false;
            state.lastPlay = playActive;
            loadVideoTimelineState.set(context.nodeId, state);
            return { ref: refWithFit, ended: endedPulse };
        },
    };
}
function createLoadVideoFromLocalNode() {
    return {
        type: 'load-video-from-local',
        label: 'Load Video From Local(Display only)',
        category: 'Assets',
        inputs: [
            { id: 'asset', label: 'Asset', type: 'string', defaultValue: '' },
            { id: 'startSec', label: 'Start (s)', type: 'number', defaultValue: 0, min: 0, step: 0.01 },
            { id: 'endSec', label: 'End (s)', type: 'number', defaultValue: -1, min: -1, step: 0.01 },
            {
                id: 'cursorSec',
                label: 'Cursor (s)',
                type: 'number',
                defaultValue: -1,
                min: -1,
                step: 0.01,
            },
            { id: 'loop', label: 'Loop', type: 'boolean', defaultValue: false },
            { id: 'play', label: 'Play', type: 'boolean', defaultValue: true },
            { id: 'reverse', label: 'Reverse', type: 'boolean', defaultValue: false },
            { id: 'muted', label: 'Mute', type: 'boolean', defaultValue: true },
        ],
        outputs: [
            { id: 'ref', label: 'Video Out', type: 'video', kind: 'sink' },
            { id: 'ended', label: 'Ended', type: 'boolean' },
        ],
        configSchema: [
            {
                key: 'timeline',
                label: 'Timeline',
                type: 'time-range',
                defaultValue: { startSec: 0, endSec: -1, cursorSec: -1 },
                min: 0,
                step: 0.01,
            },
            {
                key: 'fit',
                label: 'Fit',
                type: 'select',
                defaultValue: 'contain',
                options: [
                    { value: 'contain', label: 'Contain' },
                    { value: 'cover', label: 'Cover' },
                    { value: 'fill', label: 'Fill' },
                ],
            },
        ],
        process: (inputs, config, context) => {
            const assetUrl = typeof inputs.asset === 'string' ? inputs.asset.trim() : '';
            const fitRaw = typeof config.fit === 'string' ? config.fit.trim().toLowerCase() : '';
            const fit = fitRaw === 'cover' || fitRaw === 'fill' ? fitRaw : 'contain';
            const startSecRaw = inputs.startSec;
            const endSecRaw = inputs.endSec;
            const cursorSecRaw = inputs.cursorSec;
            const startSec = typeof startSecRaw === 'number' && Number.isFinite(startSecRaw) ? startSecRaw : 0;
            const endSec = typeof endSecRaw === 'number' && Number.isFinite(endSecRaw) ? endSecRaw : -1;
            const cursorSec = typeof cursorSecRaw === 'number' && Number.isFinite(cursorSecRaw) ? cursorSecRaw : -1;
            const loopRaw = inputs.loop;
            const loop = typeof loopRaw === 'number' ? loopRaw >= 0.5 : Boolean(loopRaw);
            const playRaw = inputs.play;
            const play = typeof playRaw === 'number' ? playRaw >= 0.5 : Boolean(playRaw);
            const reverseRaw = inputs.reverse;
            const reverse = typeof reverseRaw === 'number' ? reverseRaw >= 0.5 : Boolean(reverseRaw);
            const mutedRaw = inputs.muted;
            const muted = typeof mutedRaw === 'number' ? mutedRaw >= 0.5 : Boolean(mutedRaw);
            const startClamped = Math.max(0, startSec);
            const endClamped = endSec >= 0 ? Math.max(startClamped, endSec) : -1;
            const tValue = endClamped >= 0 ? `${startClamped},${endClamped}` : `${startClamped},`;
            const cursorClamped = cursorSec >= 0 ? Math.max(startClamped, cursorSec) : -1;
            const cursorForPlayback = cursorClamped >= 0
                ? endClamped >= 0
                    ? Math.min(endClamped, cursorClamped)
                    : cursorClamped
                : null;
            const positionParam = cursorForPlayback !== null ? `&p=${cursorForPlayback}` : '';
            const nodeParam = context?.nodeId ? `&node=${encodeURIComponent(String(context.nodeId))}` : '';
            const fitParam = fit !== 'contain' ? `&fit=${fit}` : '';
            const baseUrl = (() => {
                if (!assetUrl)
                    return '';
                const hashIndex = assetUrl.indexOf('#');
                return hashIndex >= 0 ? assetUrl.slice(0, hashIndex) : assetUrl;
            })();
            const refBase = baseUrl
                ? `${baseUrl}#t=${tValue}&loop=${loop ? 1 : 0}&play=${play ? 1 : 0}&rev=${reverse ? 1 : 0}&muted=${muted ? 1 : 0}${positionParam}${nodeParam}`
                : '';
            const refWithFit = fitParam ? `${refBase}${fitParam}` : refBase;
            if (!baseUrl) {
                loadVideoTimelineState.delete(context.nodeId);
                return { ref: '', ended: false };
            }
            const qSec = (value) => Math.round(value * 100) / 100;
            const signature = [
                baseUrl,
                qSec(startClamped),
                qSec(endClamped),
                qSec(cursorForPlayback ?? -1),
                loop ? 1 : 0,
                reverse ? 1 : 0,
            ].join('|');
            const prevState = loadVideoTimelineState.get(context.nodeId);
            const state = prevState ?? {
                signature: '',
                lastPlay: false,
                accumulatedMs: 0,
                ended: false,
                endedPulsePending: false,
            };
            const settingsChanged = signature !== state.signature;
            if (settingsChanged) {
                state.signature = signature;
                state.accumulatedMs = 0;
                state.ended = false;
                state.endedPulsePending = false;
            }
            const playActive = play;
            const playRising = playActive && !state.lastPlay;
            if (state.ended && playRising) {
                state.accumulatedMs = 0;
                state.ended = false;
                state.endedPulsePending = false;
            }
            let durationSec = null;
            if (!loop) {
                if (reverse) {
                    const startPos = cursorForPlayback ?? (endClamped >= 0 ? endClamped : startClamped);
                    durationSec = Math.max(0, startPos - startClamped);
                }
                else if (endClamped >= 0) {
                    const startPos = cursorForPlayback ?? startClamped;
                    durationSec = Math.max(0, endClamped - startPos);
                }
            }
            const dtMs = typeof context.deltaTime === 'number' && Number.isFinite(context.deltaTime)
                ? Math.max(0, context.deltaTime)
                : 0;
            if (!loop && durationSec !== null && playActive && !state.ended) {
                if (durationSec <= 0) {
                    state.ended = true;
                    state.endedPulsePending = true;
                }
                else if (state.lastPlay) {
                    state.accumulatedMs += dtMs;
                    if (state.accumulatedMs >= durationSec * 1000) {
                        state.accumulatedMs = durationSec * 1000;
                        state.ended = true;
                        state.endedPulsePending = true;
                    }
                }
            }
            const endedPulse = state.endedPulsePending;
            state.endedPulsePending = false;
            state.lastPlay = playActive;
            loadVideoTimelineState.set(context.nodeId, state);
            return { ref: refWithFit, ended: endedPulse };
        },
    };
}
function createAudioOutNode() {
    return {
        type: 'audio-out',
        label: 'Audio Patch to Client',
        category: 'Media',
        inputs: [{ id: 'in', label: 'In', type: 'audio', kind: 'sink' }],
        outputs: [
            // Manager-only routing: connect to `client-object(in)` to indicate patch target(s).
            // This output is not part of the exported client patch subgraph.
            { id: 'cmd', label: 'Deploy', type: 'command' },
        ],
        configSchema: [],
        process: () => ({}),
    };
}
function createImageOutNode(deps) {
    const resolveUrl = (raw) => {
        if (typeof raw === 'string')
            return raw.trim();
        if (Array.isArray(raw)) {
            for (const item of raw) {
                if (typeof item === 'string' && item.trim())
                    return item.trim();
                if (item && typeof item === 'object' && typeof item.url === 'string') {
                    const url = String(item.url).trim();
                    if (url)
                        return url;
                }
            }
            return '';
        }
        if (raw && typeof raw === 'object' && typeof raw.url === 'string') {
            return String(raw.url).trim();
        }
        return '';
    };
    const hide = () => {
        deps.executeCommand({ action: 'hideImage', payload: {} });
    };
    return {
        type: 'image-out',
        label: 'Image to Client',
        category: 'Media',
        inputs: [{ id: 'in', label: 'In', type: 'image', kind: 'sink' }],
        outputs: [
            // Manager-only routing: connect to `client-object(in)` to indicate patch target(s).
            // This output is not part of the exported client patch subgraph.
            { id: 'cmd', label: 'Deploy', type: 'command' },
        ],
        configSchema: [],
        process: () => ({}),
        onSink: (inputs) => {
            const url = resolveUrl(inputs.in);
            if (!url) {
                hide();
                return;
            }
            deps.executeCommand({ action: 'showImage', payload: { url } });
        },
        onDisable: () => {
            hide();
        },
    };
}
function createVideoOutNode(deps) {
    const resolveUrl = (raw) => {
        if (typeof raw === 'string')
            return raw.trim();
        if (Array.isArray(raw)) {
            for (const item of raw) {
                if (typeof item === 'string' && item.trim())
                    return item.trim();
                if (item && typeof item === 'object' && typeof item.url === 'string') {
                    const url = String(item.url).trim();
                    if (url)
                        return url;
                }
            }
            return '';
        }
        if (raw && typeof raw === 'object' && typeof raw.url === 'string') {
            return String(raw.url).trim();
        }
        return '';
    };
    const parseMutedFromUrl = (url) => {
        const trimmed = url.trim();
        if (!trimmed)
            return null;
        const index = trimmed.indexOf('#');
        const paramsRaw = index >= 0 ? trimmed.slice(index + 1) : '';
        if (!paramsRaw)
            return null;
        const params = new URLSearchParams(paramsRaw);
        const value = params.get('muted');
        if (value === null)
            return null;
        const normalized = value.trim().toLowerCase();
        if (!normalized)
            return null;
        if (normalized === 'true')
            return true;
        if (normalized === 'false')
            return false;
        const n = Number(normalized);
        if (Number.isFinite(n))
            return n >= 0.5;
        return null;
    };
    const stop = () => {
        deps.executeCommand({ action: 'stopMedia', payload: {} });
    };
    return {
        type: 'video-out',
        label: 'Video to Client',
        category: 'Media',
        inputs: [{ id: 'in', label: 'In', type: 'video', kind: 'sink' }],
        outputs: [
            // Manager-only routing: connect to `client-object(in)` to indicate patch target(s).
            // This output is not part of the exported client patch subgraph.
            { id: 'cmd', label: 'Deploy', type: 'command' },
        ],
        configSchema: [],
        process: () => ({}),
        onSink: (inputs) => {
            const url = resolveUrl(inputs.in);
            if (!url) {
                stop();
                return;
            }
            const muted = parseMutedFromUrl(url);
            deps.executeCommand({
                action: 'playMedia',
                payload: {
                    url,
                    mediaType: 'video',
                    ...(muted === null ? {} : { muted }),
                },
            });
        },
        onDisable: () => {
            stop();
        },
    };
}
function createClientObjectNode(deps) {
    return {
        type: 'client-object',
        label: 'Client',
        category: 'Objects',
        inputs: [
            { id: 'index', label: 'Index', type: 'number', defaultValue: 1, min: 1, step: 1 },
            { id: 'range', label: 'Range', type: 'number', defaultValue: 1, min: 1, step: 1 },
            { id: 'random', label: 'Random', type: 'boolean', defaultValue: false },
            { id: 'in', label: 'In', type: 'command', kind: 'sink' },
        ],
        outputs: [
            { id: 'out', label: 'Out', type: 'client' },
            { id: 'indexOut', label: 'Index Out', type: 'number' },
        ],
        configSchema: [{ key: 'clientId', label: 'Clients', type: 'client-picker', defaultValue: '' }],
        process: (inputs, config, context) => {
            const configured = typeof config.clientId === 'string' ? String(config.clientId) : '';
            const available = deps.getAllClientIds?.() ?? [];
            const selection = selectClientIdsForNode(context.nodeId, available, {
                index: inputs.index,
                range: inputs.range,
                random: inputs.random,
            });
            const fallbackSelected = deps.getSelectedClientIds?.() ?? [];
            const primaryClientId = selection.selectedIds[0] ?? fallbackSelected[0] ?? deps.getClientId() ?? configured;
            const latest = primaryClientId
                ? (deps.getSensorForClientId?.(primaryClientId) ?? deps.getLatestSensor?.() ?? null)
                : (deps.getLatestSensor?.() ?? null);
            const sensors = latest
                ? {
                    sensorType: latest.sensorType,
                    payload: latest.payload,
                    serverTimestamp: latest.serverTimestamp,
                    clientTimestamp: latest.clientTimestamp,
                }
                : null;
            const out = { clientId: primaryClientId, sensors };
            return { out, indexOut: selection.index };
        },
        onSink: (inputs, config, context) => {
            const configured = typeof config.clientId === 'string' ? String(config.clientId) : '';
            const available = deps.getAllClientIds?.() ?? [];
            const selection = selectClientIdsForNode(context.nodeId, available, {
                index: inputs.index,
                range: inputs.range,
                random: inputs.random,
            });
            const fallbackSelected = deps.getSelectedClientIds?.() ?? [];
            const fallbackSingle = deps.getClientId() ?? configured;
            const targets = selection.selectedIds.length > 0
                ? selection.selectedIds
                : fallbackSelected.length > 0
                    ? fallbackSelected
                    : fallbackSingle
                        ? [fallbackSingle]
                        : [];
            if (targets.length === 0)
                return;
            const raw = inputs.in;
            const commands = (Array.isArray(raw) ? raw : [raw]);
            for (const cmd of commands) {
                if (!cmd || typeof cmd !== 'object')
                    continue;
                const action = cmd.action;
                if (!action)
                    continue;
                const next = {
                    action,
                    payload: (cmd.payload ?? {}),
                    executeAt: cmd.executeAt,
                };
                for (const clientId of targets) {
                    if (!clientId)
                        continue;
                    if (deps.executeCommandForClientId)
                        deps.executeCommandForClientId(clientId, next);
                    else
                        deps.executeCommand(next);
                }
            }
        },
        onDisable: (inputs, config, context) => {
            const configured = typeof config.clientId === 'string' ? String(config.clientId) : '';
            const available = deps.getAllClientIds?.() ?? [];
            const selection = selectClientIdsForNode(context.nodeId, available, {
                index: inputs.index,
                range: inputs.range,
                random: inputs.random,
            });
            const fallbackSelected = deps.getSelectedClientIds?.() ?? [];
            const fallbackSingle = deps.getClientId() ?? configured;
            const targets = selection.selectedIds.length > 0
                ? selection.selectedIds
                : fallbackSelected.length > 0
                    ? fallbackSelected
                    : fallbackSingle
                        ? [fallbackSingle]
                        : [];
            if (targets.length === 0)
                return;
            const send = (clientId, cmd) => {
                if (!clientId)
                    return;
                if (deps.executeCommandForClientId)
                    deps.executeCommandForClientId(clientId, cmd);
                else
                    deps.executeCommand(cmd);
            };
            const cleanupCommands = [
                { action: 'stopSound', payload: {} },
                { action: 'stopMedia', payload: {} },
                { action: 'hideImage', payload: {} },
                { action: 'flashlight', payload: { mode: 'off' } },
                { action: 'screenColor', payload: { color: '#000000', opacity: 0, mode: 'solid' } },
            ];
            for (const clientId of targets) {
                for (const cmd of cleanupCommands)
                    send(clientId, cmd);
            }
        },
    };
}
function createCmdAggregatorNode() {
    const maxInputs = 8;
    const inputs = Array.from({ length: maxInputs }, (_, idx) => {
        const n = idx + 1;
        return { id: `in${n}`, label: `In ${n}`, type: 'command' };
    });
    const flattenCommands = (value, out) => {
        if (value === null || value === undefined)
            return;
        if (Array.isArray(value)) {
            for (const item of value)
                flattenCommands(item, out);
            return;
        }
        out.push(value);
    };
    return {
        type: 'cmd-aggregator',
        label: 'Cmd Aggregator',
        category: 'Objects',
        inputs: [...inputs],
        outputs: [{ id: 'cmd', label: 'Cmd', type: 'command' }],
        configSchema: [],
        process: (nodeInputs) => {
            const cmds = [];
            for (const port of inputs) {
                flattenCommands(nodeInputs[port.id], cmds);
            }
            return { cmd: cmds.length > 0 ? cmds : null };
        },
    };
}
function createClientSensorsProcessorNode() {
    const toFiniteNumber = (value, fallback = 0) => {
        const n = typeof value === 'number' ? value : Number(value);
        return Number.isFinite(n) ? n : fallback;
    };
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
            const client = inputs.client;
            const msg = client?.sensors;
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
            if (!msg || typeof msg !== 'object')
                return out;
            const payload = msg.payload ?? {};
            switch (msg.sensorType) {
                case 'accel':
                    out.accelX = toFiniteNumber(payload.x);
                    out.accelY = toFiniteNumber(payload.y);
                    out.accelZ = toFiniteNumber(payload.z);
                    break;
                case 'gyro':
                case 'orientation':
                    out.gyroA = toFiniteNumber(payload.alpha);
                    out.gyroB = toFiniteNumber(payload.beta);
                    out.gyroG = toFiniteNumber(payload.gamma);
                    break;
                case 'mic':
                    out.micVol = toFiniteNumber(payload.volume);
                    out.micLow = toFiniteNumber(payload.lowEnergy);
                    out.micHigh = toFiniteNumber(payload.highEnergy);
                    out.micBpm = toFiniteNumber(payload.bpm);
                    break;
            }
            return out;
        },
    };
}
function createMathNode() {
    return {
        type: 'math',
        label: 'Math',
        category: 'Logic',
        inputs: [
            { id: 'a', label: 'A', type: 'number', defaultValue: 0 },
            { id: 'b', label: 'B', type: 'number', defaultValue: 0 },
            { id: 'operation', label: 'Operation', type: 'string' },
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
            const a = inputs.a ?? 0;
            const b = inputs.b ?? 0;
            const op = (() => {
                const fromInput = inputs.operation;
                if (typeof fromInput === 'string' && fromInput.trim())
                    return fromInput.trim();
                return String(config.operation ?? '+');
            })();
            let result;
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
function createLogicAddNode() {
    return {
        type: 'logic-add',
        label: 'Add',
        category: 'Logic',
        inputs: [
            { id: 'number', label: 'Number', type: 'number', defaultValue: 0 },
            { id: 'any', label: 'Any', type: 'any' },
        ],
        outputs: [
            { id: 'number', label: 'Number', type: 'number' },
            { id: 'any', label: 'Any', type: 'any' },
        ],
        configSchema: [],
        process: (inputs) => {
            const raw = inputs.number;
            const numberValue = typeof raw === 'number' && Number.isFinite(raw) ? raw : Number(raw ?? 0);
            return {
                // Add 1 to the number input on every pass, regardless of which port triggered upstream.
                number: (Number.isFinite(numberValue) ? numberValue : 0) + 1,
                any: inputs.any,
            };
        },
    };
}
function createLogicMultipleNode() {
    return {
        type: 'logic-multiple',
        label: 'Multiple',
        category: 'Logic',
        inputs: [
            { id: 'number', label: 'Number', type: 'number', defaultValue: 0 },
            { id: 'any', label: 'Any', type: 'any' },
        ],
        outputs: [
            { id: 'number', label: 'Number', type: 'number' },
            { id: 'any', label: 'Any', type: 'any' },
        ],
        configSchema: [],
        process: (inputs) => {
            const raw = inputs.number;
            const numberValue = typeof raw === 'number' && Number.isFinite(raw) ? raw : Number(raw ?? 0);
            return {
                number: (Number.isFinite(numberValue) ? numberValue : 0) * 1,
                any: inputs.any,
            };
        },
    };
}
function createLogicSubtractNode() {
    return {
        type: 'logic-subtract',
        label: 'Subtract',
        category: 'Logic',
        inputs: [
            { id: 'number', label: 'Number', type: 'number', defaultValue: 0 },
            { id: 'any', label: 'Any', type: 'any' },
        ],
        outputs: [
            { id: 'number', label: 'Number', type: 'number' },
            { id: 'any', label: 'Any', type: 'any' },
        ],
        configSchema: [],
        process: (inputs) => {
            const raw = inputs.number;
            const numberValue = typeof raw === 'number' && Number.isFinite(raw) ? raw : Number(raw ?? 0);
            return {
                number: (Number.isFinite(numberValue) ? numberValue : 0) - 1,
                any: inputs.any,
            };
        },
    };
}
function createLogicDivideNode() {
    return {
        type: 'logic-divide',
        label: 'Divide',
        category: 'Logic',
        inputs: [
            { id: 'number', label: 'Number', type: 'number', defaultValue: 0 },
            { id: 'any', label: 'Any', type: 'any' },
        ],
        outputs: [
            { id: 'number', label: 'Number', type: 'number' },
            { id: 'any', label: 'Any', type: 'any' },
        ],
        configSchema: [],
        process: (inputs) => {
            const raw = inputs.number;
            const numberValue = typeof raw === 'number' && Number.isFinite(raw) ? raw : Number(raw ?? 0);
            return {
                number: (Number.isFinite(numberValue) ? numberValue : 0) / 1,
                any: inputs.any,
            };
        },
    };
}
function createLogicIfNode() {
    return {
        type: 'logic-if',
        label: 'if',
        category: 'Logic',
        inputs: [
            { id: 'input', label: 'input', type: 'number', defaultValue: 0 },
            { id: 'condition', label: 'condition', type: 'number', defaultValue: 0 },
        ],
        outputs: [
            { id: 'false', label: 'false', type: 'number' },
            { id: 'true', label: 'true', type: 'number' },
        ],
        configSchema: [],
        process: (inputs) => {
            const inputRaw = inputs.input;
            const conditionRaw = inputs.condition;
            const inputValue = typeof inputRaw === 'number' && Number.isFinite(inputRaw)
                ? inputRaw
                : Number(inputRaw ?? 0);
            const conditionValue = typeof conditionRaw === 'number' && Number.isFinite(conditionRaw)
                ? conditionRaw
                : Number(conditionRaw ?? 0);
            const value = Number.isFinite(inputValue) ? inputValue : 0;
            const condition = Number.isFinite(conditionValue) ? conditionValue : 0;
            // Treat condition as a numeric boolean (>= 0.5 is true).
            if (condition >= 0.5)
                return { true: value };
            return { false: value };
        },
    };
}
const logicForState = new Map();
function createLogicForNode() {
    return {
        type: 'logic-for',
        label: 'for',
        category: 'Logic',
        inputs: [
            { id: 'start', label: 'start', type: 'number', defaultValue: 1 },
            { id: 'end', label: 'end', type: 'number', defaultValue: 1 },
        ],
        outputs: [{ id: 'index', label: 'index', type: 'number' }],
        configSchema: [],
        process: (inputs, _config, context) => {
            const startRaw = inputs.start;
            const endRaw = inputs.end;
            const startValue = typeof startRaw === 'number' && Number.isFinite(startRaw)
                ? startRaw
                : Number(startRaw ?? 1);
            const endValue = typeof endRaw === 'number' && Number.isFinite(endRaw) ? endRaw : Number(endRaw ?? 1);
            const start = Math.round(Number.isFinite(startValue) ? startValue : 1);
            const end = Math.round(Number.isFinite(endValue) ? endValue : 1);
            const clampedStart = Math.max(1, start);
            const clampedEnd = Math.max(clampedStart, end);
            const prev = logicForState.get(context.nodeId);
            if (!prev || prev.start !== clampedStart || prev.end !== clampedEnd) {
                const initial = { current: clampedStart, start: clampedStart, end: clampedEnd };
                const out = initial.current;
                initial.current = out >= initial.end ? initial.start : out + 1;
                logicForState.set(context.nodeId, initial);
                return { index: out };
            }
            const out = prev.current;
            prev.current = out >= prev.end ? prev.start : out + 1;
            logicForState.set(context.nodeId, prev);
            return { index: out };
        },
    };
}
// Sleep node keeps a small time queue to delay signals by the configured milliseconds.
const logicSleepState = new Map();
function createLogicSleepNode() {
    return {
        type: 'logic-sleep',
        label: 'Sleep',
        category: 'Logic',
        inputs: [
            { id: 'input', label: 'input', type: 'any' },
            { id: 'sleepTimeMs', label: 'sleep time (ms)', type: 'number', defaultValue: 0 },
        ],
        outputs: [{ id: 'output', label: 'output', type: 'any' }],
        configSchema: [],
        process: (inputs, _config, context) => {
            const rawDelay = inputs.sleepTimeMs;
            const parsed = typeof rawDelay === 'number' ? rawDelay : Number(rawDelay ?? 0);
            const delayMs = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
            const state = logicSleepState.get(context.nodeId) ?? {
                queue: [],
                lastOutput: undefined,
            };
            state.queue.push({ time: context.time, value: inputs.input });
            const targetTime = context.time - delayMs;
            while (state.queue.length > 0 && state.queue[0].time <= targetTime) {
                const item = state.queue.shift();
                if (item)
                    state.lastOutput = item.value;
            }
            logicSleepState.set(context.nodeId, state);
            return { output: state.lastOutput };
        },
    };
}
const TONE_LFO_WAVEFORM_OPTIONS = [
    { value: 'sine', label: 'Sine' },
    { value: 'square', label: 'Square' },
    { value: 'triangle', label: 'Triangle' },
    { value: 'sawtooth', label: 'Sawtooth' },
];
function createToneLFONode() {
    return {
        type: 'tone-lfo',
        label: 'Tone LFO',
        category: 'Audio',
        inputs: [
            {
                id: 'frequencyHz',
                label: 'Freq (Hz)',
                type: 'number',
                defaultValue: 1,
                min: 0,
                step: 0.01,
            },
            { id: 'min', label: 'Min', type: 'number', defaultValue: 0, step: 0.01 },
            { id: 'max', label: 'Max', type: 'number', defaultValue: 1, step: 0.01 },
            {
                id: 'amplitude',
                label: 'Depth',
                type: 'number',
                defaultValue: 1,
                min: 0,
                max: 1,
                step: 0.01,
            },
            { id: 'waveform', label: 'Waveform', type: 'string' },
            { id: 'enabled', label: 'Enabled', type: 'boolean', defaultValue: true },
        ],
        outputs: [{ id: 'value', label: 'Value', type: 'number' }],
        configSchema: [
            {
                key: 'frequencyHz',
                label: 'Freq (Hz)',
                type: 'number',
                defaultValue: 1,
                min: 0,
                step: 0.01,
            },
            { key: 'min', label: 'Min', type: 'number', defaultValue: 0, step: 0.01 },
            { key: 'max', label: 'Max', type: 'number', defaultValue: 1, step: 0.01 },
            {
                key: 'amplitude',
                label: 'Depth',
                type: 'number',
                defaultValue: 1,
                min: 0,
                max: 1,
                step: 0.01,
            },
            {
                key: 'waveform',
                label: 'Waveform',
                type: 'select',
                defaultValue: 'sine',
                options: TONE_LFO_WAVEFORM_OPTIONS,
            },
            { key: 'enabled', label: 'Enabled', type: 'boolean', defaultValue: true },
        ],
        process: (inputs, config, context) => {
            const frequencyHz = typeof inputs.frequencyHz === 'number'
                ? inputs.frequencyHz
                : Number(config.frequencyHz ?? 1);
            const min = typeof inputs.min === 'number' ? inputs.min : Number(config.min ?? 0);
            const max = typeof inputs.max === 'number' ? inputs.max : Number(config.max ?? 1);
            const amplitudeRaw = typeof inputs.amplitude === 'number'
                ? inputs.amplitude
                : Number(config.amplitude ?? 1);
            const amplitude = Number.isFinite(amplitudeRaw) ? Math.max(0, Math.min(1, amplitudeRaw)) : 1;
            const enabledRaw = inputs.enabled;
            const enabled = typeof enabledRaw === 'number'
                ? enabledRaw >= 0.5
                : typeof enabledRaw === 'boolean'
                    ? enabledRaw
                    : Boolean(config.enabled ?? true);
            const waveform = (() => {
                const v = inputs.waveform;
                if (typeof v === 'string' && v.trim())
                    return v.trim();
                return String(config.waveform ?? 'sine');
            })();
            if (!enabled)
                return { value: min };
            const freq = Number.isFinite(frequencyHz) ? Math.max(0, frequencyHz) : 1;
            const phase = (context.time / 1000) * freq * 2 * Math.PI;
            let normalized;
            switch (waveform) {
                case 'sine':
                    normalized = (Math.sin(phase) + 1) / 2;
                    break;
                case 'square':
                    normalized = Math.sin(phase) >= 0 ? 1 : 0;
                    break;
                case 'triangle':
                    normalized = Math.abs((((context.time / 1000) * freq * 2) % 2) - 1);
                    break;
                case 'sawtooth':
                    normalized = ((context.time / 1000) * freq) % 1;
                    break;
                default:
                    normalized = (Math.sin(phase) + 1) / 2;
            }
            const centered = 0.5 + (normalized - 0.5) * amplitude;
            const value = min + centered * (max - min);
            return { value };
        },
    };
}
// Value-box style nodes: editable constants that also pass through connected inputs.
function createNumberNode() {
    return {
        type: 'number',
        label: 'Number',
        category: 'Values',
        inputs: [{ id: 'value', label: 'Value', type: 'number' }],
        outputs: [{ id: 'value', label: 'Value', type: 'number' }],
        configSchema: [{ key: 'value', label: 'Value', type: 'number', defaultValue: 0 }],
        process: (inputs, config) => {
            const fromInput = inputs.value;
            if (typeof fromInput === 'number' && Number.isFinite(fromInput))
                return { value: fromInput };
            const fallback = Number(config.value ?? 0);
            return { value: Number.isFinite(fallback) ? fallback : 0 };
        },
    };
}
function createStringNode() {
    return {
        type: 'string',
        label: 'String',
        category: 'Values',
        inputs: [{ id: 'value', label: 'Value', type: 'string' }],
        outputs: [{ id: 'value', label: 'Value', type: 'string' }],
        configSchema: [{ key: 'value', label: 'Value', type: 'string', defaultValue: '' }],
        process: (inputs, config) => {
            const fromInput = inputs.value;
            if (typeof fromInput === 'string')
                return { value: fromInput };
            const fallback = config.value;
            return { value: typeof fallback === 'string' ? fallback : '' };
        },
    };
}
function createBoolNode() {
    const coerce = (value) => {
        if (typeof value === 'boolean')
            return value;
        if (typeof value === 'number')
            return Number.isFinite(value) ? value >= 0.5 : false;
        if (typeof value === 'string') {
            const s = value.trim().toLowerCase();
            if (!s)
                return false;
            if (s === 'true' || s === '1' || s === 'yes' || s === 'y')
                return true;
            if (s === 'false' || s === '0' || s === 'no' || s === 'n')
                return false;
            return true;
        }
        return false;
    };
    return {
        type: 'bool',
        label: 'Bool',
        category: 'Values',
        inputs: [{ id: 'value', label: 'Value', type: 'boolean' }],
        outputs: [{ id: 'value', label: 'Value', type: 'boolean' }],
        configSchema: [{ key: 'value', label: 'Value', type: 'boolean', defaultValue: false }],
        process: (inputs, config) => {
            if (inputs.value !== undefined)
                return { value: coerce(inputs.value) };
            return { value: coerce(config.value) };
        },
    };
}
const stabilizerState = new Map();
function createNumberStabilizerNode() {
    return {
        type: 'number-stabilizer',
        label: 'Number Stabilizer',
        category: 'Logic',
        inputs: [
            { id: 'in', label: 'In', type: 'number', defaultValue: 0 },
            { id: 'smoothing', label: 'Smoothing', type: 'number' },
        ],
        outputs: [{ id: 'out', label: 'Out', type: 'number' }],
        configSchema: [
            {
                key: 'smoothing',
                label: 'Smoothing',
                type: 'number',
                defaultValue: 0.2,
                min: 0,
                max: 2000,
                step: 10,
            },
        ],
        process: (inputs, config, context) => {
            const raw = inputs.in;
            const smoothingFromInput = inputs.smoothing;
            const smoothingRaw = typeof smoothingFromInput === 'number'
                ? smoothingFromInput
                : Number(config.smoothing ?? 0.2);
            const smoothingFinite = Number.isFinite(smoothingRaw) ? smoothingRaw : 0.2;
            // Backward-compat: if smoothing <= 1, treat it as normalized smoothing (0..1),
            // otherwise interpret it as an explicit duration in ms.
            const durationMs = smoothingFinite <= 1
                ? 50 + Math.max(0, Math.min(1, smoothingFinite)) * 950
                : Math.max(0, smoothingFinite);
            const inputValue = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
            const prev = stabilizerState.get(context.nodeId);
            if (!prev) {
                const initial = {
                    value: inputValue,
                    target: inputValue,
                    startValue: inputValue,
                    startTime: context.time,
                    durationMs,
                };
                stabilizerState.set(context.nodeId, initial);
                return { out: initial.value };
            }
            if (inputValue !== prev.target || durationMs !== prev.durationMs) {
                prev.startValue = prev.value;
                prev.target = inputValue;
                prev.startTime = context.time;
                prev.durationMs = durationMs;
            }
            const elapsed = Math.max(0, context.time - prev.startTime);
            const t = prev.durationMs <= 0 ? 1 : Math.max(0, Math.min(1, elapsed / prev.durationMs));
            prev.value = prev.startValue + (prev.target - prev.startValue) * t;
            stabilizerState.set(context.nodeId, prev);
            return { out: prev.value };
        },
    };
}
function createToneOscNode() {
    return {
        type: 'tone-osc',
        label: 'Tone Osc',
        category: 'Audio',
        inputs: [
            { id: 'frequency', label: 'Freq', type: 'number', defaultValue: 440 },
            { id: 'amplitude', label: 'Amp', type: 'number', defaultValue: 1 },
            { id: 'waveform', label: 'Waveform', type: 'string' },
            { id: 'bus', label: 'Bus', type: 'string' },
            { id: 'enabled', label: 'Enabled', type: 'boolean' },
            { id: 'loop', label: 'Loop (pattern)', type: 'string' },
        ],
        outputs: [{ id: 'value', label: 'Out', type: 'audio', kind: 'sink' }],
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
            {
                key: 'bus',
                label: 'Bus',
                type: 'string',
                defaultValue: 'main',
            },
            {
                key: 'enabled',
                label: 'Enabled',
                type: 'boolean',
                defaultValue: false,
            },
            {
                key: 'loop',
                label: 'Loop (pattern)',
                type: 'string',
                defaultValue: '',
            },
        ],
        process: (inputs, config) => {
            const ampInput = Number(inputs.amplitude ?? 0);
            const enabledRaw = inputs.enabled;
            const enabled = typeof enabledRaw === 'number'
                ? enabledRaw >= 0.5
                : (enabledRaw ?? config.enabled ?? false);
            const value = enabled ? ampInput : 0;
            return { value };
        },
    };
}
function createToneDelayNode() {
    return {
        type: 'tone-delay',
        label: 'Tone Delay',
        category: 'Audio',
        inputs: [
            { id: 'in', label: 'In', type: 'audio', kind: 'sink' },
            { id: 'time', label: 'Time (s)', type: 'number', defaultValue: 0.25 },
            { id: 'feedback', label: 'Feedback', type: 'number', defaultValue: 0.35 },
            { id: 'wet', label: 'Wet', type: 'number', defaultValue: 0.3 },
            { id: 'bus', label: 'Bus', type: 'string' },
            { id: 'order', label: 'Order', type: 'number' },
            { id: 'enabled', label: 'Enabled', type: 'boolean' },
        ],
        outputs: [{ id: 'out', label: 'Out', type: 'audio', kind: 'sink' }],
        configSchema: [
            { key: 'time', label: 'Time (s)', type: 'number', defaultValue: 0.25 },
            { key: 'feedback', label: 'Feedback', type: 'number', defaultValue: 0.35 },
            { key: 'wet', label: 'Wet', type: 'number', defaultValue: 0.3 },
            { key: 'bus', label: 'Bus', type: 'string', defaultValue: 'main' },
            { key: 'order', label: 'Order', type: 'number', defaultValue: 10 },
            { key: 'enabled', label: 'Enabled', type: 'boolean', defaultValue: true },
        ],
        process: (inputs) => ({ out: inputs.in ?? 0 }),
    };
}
function createToneResonatorNode() {
    return {
        type: 'tone-resonator',
        label: 'Tone Resonator',
        category: 'Audio',
        inputs: [
            { id: 'in', label: 'In', type: 'audio', kind: 'sink' },
            { id: 'delayTime', label: 'Delay (s)', type: 'number', defaultValue: 0.08 },
            { id: 'resonance', label: 'Resonance', type: 'number', defaultValue: 0.6 },
            { id: 'dampening', label: 'Dampening', type: 'number', defaultValue: 3000 },
            { id: 'wet', label: 'Wet', type: 'number', defaultValue: 0.4 },
            { id: 'bus', label: 'Bus', type: 'string' },
            { id: 'order', label: 'Order', type: 'number' },
            { id: 'enabled', label: 'Enabled', type: 'boolean' },
        ],
        outputs: [{ id: 'out', label: 'Out', type: 'audio', kind: 'sink' }],
        configSchema: [
            { key: 'delayTime', label: 'Delay (s)', type: 'number', defaultValue: 0.08 },
            { key: 'resonance', label: 'Resonance', type: 'number', defaultValue: 0.6 },
            { key: 'dampening', label: 'Dampening (Hz)', type: 'number', defaultValue: 3000 },
            { key: 'wet', label: 'Wet', type: 'number', defaultValue: 0.4 },
            { key: 'bus', label: 'Bus', type: 'string', defaultValue: 'main' },
            { key: 'order', label: 'Order', type: 'number', defaultValue: 20 },
            { key: 'enabled', label: 'Enabled', type: 'boolean', defaultValue: true },
        ],
        process: (inputs) => ({ out: inputs.in ?? 0 }),
    };
}
function createTonePitchNode() {
    return {
        type: 'tone-pitch',
        label: 'Tone Pitch',
        category: 'Audio',
        inputs: [
            { id: 'in', label: 'In', type: 'audio', kind: 'sink' },
            { id: 'pitch', label: 'Pitch (st)', type: 'number', defaultValue: 0 },
            { id: 'windowSize', label: 'Window', type: 'number', defaultValue: 0.1 },
            { id: 'delayTime', label: 'Delay (s)', type: 'number', defaultValue: 0 },
            { id: 'feedback', label: 'Feedback', type: 'number', defaultValue: 0 },
            { id: 'wet', label: 'Wet', type: 'number', defaultValue: 0.3 },
            { id: 'bus', label: 'Bus', type: 'string' },
            { id: 'order', label: 'Order', type: 'number' },
            { id: 'enabled', label: 'Enabled', type: 'boolean' },
        ],
        outputs: [{ id: 'out', label: 'Out', type: 'audio', kind: 'sink' }],
        configSchema: [
            { key: 'pitch', label: 'Pitch (st)', type: 'number', defaultValue: 0 },
            { key: 'windowSize', label: 'Window', type: 'number', defaultValue: 0.1 },
            { key: 'delayTime', label: 'Delay (s)', type: 'number', defaultValue: 0 },
            { key: 'feedback', label: 'Feedback', type: 'number', defaultValue: 0 },
            { key: 'wet', label: 'Wet', type: 'number', defaultValue: 0.3 },
            { key: 'bus', label: 'Bus', type: 'string', defaultValue: 'main' },
            { key: 'order', label: 'Order', type: 'number', defaultValue: 30 },
            { key: 'enabled', label: 'Enabled', type: 'boolean', defaultValue: true },
        ],
        process: (inputs) => ({ out: inputs.in ?? 0 }),
    };
}
function createToneReverbNode() {
    return {
        type: 'tone-reverb',
        label: 'Tone Reverb',
        category: 'Audio',
        inputs: [
            { id: 'in', label: 'In', type: 'audio', kind: 'sink' },
            { id: 'decay', label: 'Decay (s)', type: 'number', defaultValue: 1.6 },
            { id: 'preDelay', label: 'PreDelay (s)', type: 'number', defaultValue: 0.01 },
            { id: 'wet', label: 'Wet', type: 'number', defaultValue: 0.3 },
            { id: 'bus', label: 'Bus', type: 'string' },
            { id: 'order', label: 'Order', type: 'number' },
            { id: 'enabled', label: 'Enabled', type: 'boolean' },
        ],
        outputs: [{ id: 'out', label: 'Out', type: 'audio', kind: 'sink' }],
        configSchema: [
            { key: 'decay', label: 'Decay (s)', type: 'number', defaultValue: 1.6 },
            { key: 'preDelay', label: 'PreDelay (s)', type: 'number', defaultValue: 0.01 },
            { key: 'wet', label: 'Wet', type: 'number', defaultValue: 0.3 },
            { key: 'bus', label: 'Bus', type: 'string', defaultValue: 'main' },
            { key: 'order', label: 'Order', type: 'number', defaultValue: 40 },
            { key: 'enabled', label: 'Enabled', type: 'boolean', defaultValue: true },
        ],
        process: (inputs) => ({ out: inputs.in ?? 0 }),
    };
}
function createToneGranularNode() {
    return {
        type: 'tone-granular',
        label: 'Tone Granular',
        category: 'Audio',
        inputs: [
            { id: 'url', label: 'URL', type: 'string' },
            { id: 'gate', label: 'Gate', type: 'number', defaultValue: 0 },
            { id: 'enabled', label: 'Enabled', type: 'boolean' },
            { id: 'loop', label: 'Loop', type: 'boolean' },
            { id: 'playbackRate', label: 'Rate', type: 'number', defaultValue: 1 },
            { id: 'detune', label: 'Detune', type: 'number', defaultValue: 0 },
            { id: 'grainSize', label: 'Grain (s)', type: 'number', defaultValue: 0.2 },
            { id: 'overlap', label: 'Overlap (s)', type: 'number', defaultValue: 0.1 },
            { id: 'volume', label: 'Volume', type: 'number', defaultValue: 0.6 },
            { id: 'bus', label: 'Bus', type: 'string' },
        ],
        outputs: [{ id: 'value', label: 'Out', type: 'audio', kind: 'sink' }],
        configSchema: [
            { key: 'url', label: 'Audio URL', type: 'string', defaultValue: '' },
            { key: 'loop', label: 'Loop', type: 'boolean', defaultValue: true },
            { key: 'playbackRate', label: 'Rate', type: 'number', defaultValue: 1 },
            { key: 'detune', label: 'Detune', type: 'number', defaultValue: 0 },
            { key: 'grainSize', label: 'Grain (s)', type: 'number', defaultValue: 0.2 },
            { key: 'overlap', label: 'Overlap (s)', type: 'number', defaultValue: 0.1 },
            { key: 'volume', label: 'Volume', type: 'number', defaultValue: 0.6 },
            { key: 'bus', label: 'Bus', type: 'string', defaultValue: 'main' },
            { key: 'enabled', label: 'Enabled', type: 'boolean', defaultValue: false },
        ],
        process: (inputs, config) => {
            const volume = typeof inputs.volume === 'number'
                ? inputs.volume
                : Number(config.volume ?? 0.6);
            return { value: volume };
        },
    };
}
const playMediaTriggerState = new Map();
const playMediaCommandCache = new Map();
function createPlayMediaNode() {
    const resolveUrl = (inputs, config, key) => {
        const fromInput = inputs[key];
        if (typeof fromInput === 'string' && fromInput.trim())
            return fromInput.trim();
        const fromConfig = config[key];
        if (typeof fromConfig === 'string' && fromConfig.trim())
            return fromConfig.trim();
        return '';
    };
    return {
        type: 'play-media',
        label: 'Play Media',
        category: 'Audio',
        inputs: [
            { id: 'audioUrl', label: 'Audio', type: 'string' },
            { id: 'imageUrl', label: 'Image', type: 'string' },
            { id: 'videoUrl', label: 'Video', type: 'string' },
            { id: 'trigger', label: 'Trigger', type: 'number' },
            {
                id: 'volume',
                label: 'Volume',
                type: 'number',
                defaultValue: 1,
                min: 0,
                max: 1,
                step: 0.01,
            },
            { id: 'loop', label: 'Loop', type: 'boolean', defaultValue: false },
            { id: 'fadeIn', label: 'Fade In (ms)', type: 'number', defaultValue: 0, min: 0, step: 10 },
            { id: 'muted', label: 'Video Muted', type: 'boolean', defaultValue: true },
            {
                id: 'imageDuration',
                label: 'Image Duration (ms)',
                type: 'number',
                defaultValue: 0,
                min: 0,
                step: 100,
            },
        ],
        outputs: [{ id: 'cmd', label: 'Cmd', type: 'command' }],
        configSchema: [
            { key: 'audioUrl', label: 'Audio URL', type: 'string', defaultValue: '' },
            { key: 'imageUrl', label: 'Image URL', type: 'string', defaultValue: '' },
            { key: 'videoUrl', label: 'Video URL', type: 'string', defaultValue: '' },
            {
                key: 'volume',
                label: 'Volume',
                type: 'number',
                defaultValue: 1,
                min: 0,
                max: 1,
                step: 0.01,
            },
            { key: 'loop', label: 'Loop', type: 'boolean', defaultValue: false },
            { key: 'fadeIn', label: 'Fade In (ms)', type: 'number', defaultValue: 0, min: 0, step: 10 },
            { key: 'muted', label: 'Video Muted', type: 'boolean', defaultValue: true },
            {
                key: 'imageDuration',
                label: 'Image Duration (ms)',
                type: 'number',
                defaultValue: 0,
                min: 0,
                step: 100,
            },
        ],
        process: (inputs, config, context) => {
            const triggerRaw = inputs.trigger;
            const hasTrigger = triggerRaw !== undefined && triggerRaw !== null;
            const triggerActive = typeof triggerRaw === 'number' ? triggerRaw >= 0.5 : Boolean(triggerRaw);
            if (hasTrigger) {
                const prev = playMediaTriggerState.get(context.nodeId) ?? false;
                playMediaTriggerState.set(context.nodeId, triggerActive);
                if (!triggerActive || prev)
                    return {};
            }
            const forceSend = hasTrigger;
            const imageUrl = resolveUrl(inputs, config, 'imageUrl');
            const videoUrl = resolveUrl(inputs, config, 'videoUrl');
            const audioUrl = resolveUrl(inputs, config, 'audioUrl');
            const volumeRaw = typeof inputs.volume === 'number' ? inputs.volume : Number(config.volume ?? 1);
            const volume = Number.isFinite(volumeRaw) ? Math.max(0, Math.min(1, volumeRaw)) : 1;
            const loop = typeof inputs.loop === 'boolean' ? inputs.loop : Boolean(config.loop ?? false);
            const fadeInRaw = typeof inputs.fadeIn === 'number' ? inputs.fadeIn : Number(config.fadeIn ?? 0);
            const fadeIn = Number.isFinite(fadeInRaw) ? Math.max(0, fadeInRaw) : 0;
            const muted = typeof inputs.muted === 'boolean' ? inputs.muted : Boolean(config.muted ?? true);
            const imageDurationRaw = typeof inputs.imageDuration === 'number'
                ? inputs.imageDuration
                : Number(config.imageDuration ?? 0);
            const imageDuration = Number.isFinite(imageDurationRaw) && imageDurationRaw > 0 ? imageDurationRaw : undefined;
            let cmd = null;
            if (imageUrl) {
                cmd = {
                    action: 'showImage',
                    payload: {
                        url: imageUrl,
                        duration: imageDuration,
                    },
                };
            }
            else if (videoUrl) {
                cmd = {
                    action: 'playMedia',
                    payload: {
                        url: videoUrl,
                        mediaType: 'video',
                        volume,
                        loop,
                        fadeIn,
                        muted,
                    },
                };
            }
            else if (audioUrl) {
                cmd = {
                    action: 'playMedia',
                    payload: {
                        url: audioUrl,
                        mediaType: 'audio',
                        volume,
                        loop,
                        fadeIn,
                    },
                };
            }
            if (!cmd) {
                playMediaCommandCache.set(context.nodeId, { signature: '', cmd: null });
                return { cmd: null };
            }
            const signature = (() => {
                try {
                    return JSON.stringify(cmd);
                }
                catch {
                    return String(cmd.action ?? '');
                }
            })();
            if (forceSend) {
                playMediaCommandCache.set(context.nodeId, { signature, cmd });
                return { cmd };
            }
            const cached = playMediaCommandCache.get(context.nodeId);
            if (!cached || cached.signature !== signature) {
                playMediaCommandCache.set(context.nodeId, { signature, cmd });
                return { cmd };
            }
            // Reuse the cached command object to avoid deepEqual JSON stringify on large payloads.
            return { cmd: cached.cmd };
        },
    };
}
const FLASHLIGHT_MODE_OPTIONS = [
    { value: 'off', label: 'Off' },
    { value: 'on', label: 'On' },
    { value: 'blink', label: 'Blink' },
];
function createFlashlightProcessorNode() {
    return {
        type: 'proc-flashlight',
        label: 'Flashlight',
        category: 'Processors',
        inputs: [
            { id: 'mode', label: 'Mode', type: 'string' },
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
                options: FLASHLIGHT_MODE_OPTIONS,
            },
            { key: 'frequencyHz', label: 'Frequency (Hz)', type: 'number', defaultValue: 2 },
            { key: 'dutyCycle', label: 'Duty Cycle', type: 'number', defaultValue: 0.5 },
        ],
        process: (inputs, config) => {
            const fallbackMode = String(config.mode ?? 'blink');
            const mode = (() => {
                const v = inputs.mode;
                if (typeof v === 'string' && v) {
                    const options = FLASHLIGHT_MODE_OPTIONS.map((o) => o.value);
                    return options.includes(v) ? v : fallbackMode;
                }
                if (typeof v !== 'number' || !Number.isFinite(v))
                    return fallbackMode;
                const options = FLASHLIGHT_MODE_OPTIONS.map((o) => o.value);
                const clamped = Math.max(0, Math.min(1, v));
                const idx = Math.min(options.length - 1, Math.floor(clamped * options.length));
                return options[idx] ?? fallbackMode;
            })();
            if (mode === 'blink') {
                const freq = typeof inputs.frequencyHz === 'number'
                    ? inputs.frequencyHz
                    : Number(config.frequencyHz ?? 2);
                const duty = typeof inputs.dutyCycle === 'number'
                    ? inputs.dutyCycle
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
];
function createScreenColorProcessorNode() {
    return {
        type: 'proc-screen-color',
        label: 'Screen Color',
        category: 'Processors',
        inputs: [
            { id: 'primary', label: 'Primary', type: 'color' },
            { id: 'secondary', label: 'Secondary', type: 'color' },
            { id: 'waveform', label: 'Wave', type: 'string' },
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
                options: SCREEN_WAVEFORM_OPTIONS,
            },
            { key: 'frequencyHz', label: 'Frequency (Hz)', type: 'number', defaultValue: 1.5 },
        ],
        process: (inputs, config) => {
            const primary = typeof inputs.primary === 'string' && inputs.primary
                ? String(inputs.primary)
                : String(config.primary ?? '#6366f1');
            const secondary = typeof inputs.secondary === 'string' && inputs.secondary
                ? String(inputs.secondary)
                : String(config.secondary ?? '#ffffff');
            const maxOpacity = typeof inputs.maxOpacity === 'number'
                ? inputs.maxOpacity
                : Number(config.maxOpacity ?? 1);
            const minOpacity = typeof inputs.minOpacity === 'number'
                ? inputs.minOpacity
                : Number(config.minOpacity ?? 0);
            const fallbackWaveform = String(config.waveform ?? 'sine');
            const waveform = (() => {
                const v = inputs.waveform;
                if (typeof v === 'string' && v) {
                    const options = SCREEN_WAVEFORM_OPTIONS.map((o) => o.value);
                    return options.includes(v) ? v : fallbackWaveform;
                }
                if (typeof v !== 'number' || !Number.isFinite(v))
                    return fallbackWaveform;
                const options = SCREEN_WAVEFORM_OPTIONS.map((o) => o.value);
                const clamped = Math.max(0, Math.min(1, v));
                const idx = Math.min(options.length - 1, Math.floor(clamped * options.length));
                return options[idx] ?? fallbackWaveform;
            })();
            const frequencyHz = typeof inputs.frequencyHz === 'number'
                ? inputs.frequencyHz
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
];
function createSynthUpdateProcessorNode() {
    return {
        type: 'proc-synth-update',
        label: 'Synth (Update)',
        category: 'Processors',
        inputs: [
            { id: 'waveform', label: 'Wave', type: 'string' },
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
                options: SYNTH_WAVEFORM_OPTIONS,
            },
            { key: 'modDepth', label: 'Wobble Depth', type: 'number', defaultValue: 0 },
            { key: 'modFrequency', label: 'Wobble Rate (Hz)', type: 'number', defaultValue: 12 },
            { key: 'durationMs', label: 'Dur (ms)', type: 'number', defaultValue: 200 },
        ],
        process: (inputs, config) => {
            const frequency = typeof inputs.frequency === 'number'
                ? inputs.frequency
                : Number(config.frequency ?? 180);
            const volume = typeof inputs.volume === 'number'
                ? inputs.volume
                : Number(config.volume ?? 0.7);
            const depthRaw = typeof inputs.modDepth === 'number'
                ? inputs.modDepth
                : Number(config.modDepth ?? 0);
            const depth = Math.max(0, Math.min(1, depthRaw));
            const modFrequency = typeof inputs.modFrequency === 'number'
                ? inputs.modFrequency
                : Number(config.modFrequency ?? 12);
            const durationMs = typeof inputs.durationMs === 'number'
                ? inputs.durationMs
                : Number(config.durationMs ?? 200);
            const fallbackWaveform = String(config.waveform ?? 'square');
            const waveform = (() => {
                const v = inputs.waveform;
                if (typeof v === 'string' && v) {
                    const options = SYNTH_WAVEFORM_OPTIONS.map((o) => o.value);
                    return options.includes(v) ? v : fallbackWaveform;
                }
                if (typeof v !== 'number' || !Number.isFinite(v))
                    return fallbackWaveform;
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
function createSceneSwitchProcessorNode() {
    return {
        type: 'proc-scene-switch',
        label: 'Visual Scene',
        category: 'Processors',
        inputs: [
            { id: 'index', label: 'Index', type: 'number' },
            { id: 'sceneId', label: 'Scene', type: 'string' },
            { id: 'asciiEnabled', label: 'ASCII Overlay', type: 'boolean', defaultValue: true },
            { id: 'asciiResolution', label: 'ASCII Resolution', type: 'number', defaultValue: 11, min: 6, max: 24, step: 1 },
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
            { key: 'asciiEnabled', label: 'ASCII Overlay', type: 'boolean', defaultValue: true },
            { key: 'asciiResolution', label: 'ASCII Resolution', type: 'number', defaultValue: 11, min: 6, max: 24, step: 1 },
        ],
        process: (inputs, config) => {
            const sceneId = (() => {
                const fromInput = inputs.sceneId;
                if (typeof fromInput === 'string' && fromInput.trim())
                    return fromInput.trim();
                const fromIndex = inputs.index;
                if (typeof fromIndex === 'number' && Number.isFinite(fromIndex)) {
                    return fromIndex >= 0.5 ? 'mel-scene' : 'box-scene';
                }
                return String(config.sceneId ?? 'box-scene');
            })();
            // Mirror the console "Scene & Effects" controls (ASCII overlay + resolution).
            const asciiEnabled = (() => {
                const fromInput = inputs.asciiEnabled;
                if (typeof fromInput === 'number' && Number.isFinite(fromInput))
                    return fromInput >= 0.5;
                if (typeof fromInput === 'boolean')
                    return fromInput;
                const fromConfig = config.asciiEnabled;
                if (typeof fromConfig === 'number' && Number.isFinite(fromConfig))
                    return fromConfig >= 0.5;
                if (typeof fromConfig === 'boolean')
                    return fromConfig;
                return true;
            })();
            const asciiResolution = (() => {
                const fromInput = inputs.asciiResolution;
                const fromConfig = config.asciiResolution;
                const raw = typeof fromInput === 'number' ? fromInput : Number(fromInput ?? fromConfig ?? 11);
                const clamped = Number.isFinite(raw) ? Math.max(6, Math.min(24, raw)) : 11;
                return Math.round(clamped);
            })();
            return {
                cmd: [
                    { action: 'visualSceneSwitch', payload: { sceneId } },
                    { action: 'asciiMode', payload: { enabled: asciiEnabled } },
                    { action: 'asciiResolution', payload: { cellSize: asciiResolution } },
                ],
            };
        },
    };
}
//# sourceMappingURL=definitions.js.map