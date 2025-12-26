<!-- Purpose: Render Rete controls (inputs/selects/MIDI learn) for the node canvas. -->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { ClassicPreset } from 'rete';
	  import {
	    audienceClients,
	    clientReadiness,
	    nodeMediaSignals,
	    sensorData,
	  } from '$lib/stores/manager';
  import { assetsStore } from '$lib/stores/assets';
  import { localMediaStore, type LocalMediaKind } from '$lib/stores/local-media';
  import { nodeEngine } from '$lib/nodes';
  import type { ClientInfo } from '@shugu/protocol';
  import { midiService, type MidiEvent } from '$lib/features/midi/midi-service';
  import { midiNodeBridge, formatMidiSource } from '$lib/features/midi/midi-node-bridge';
  import {
    getAudioSpectrogramDataUrl,
    getMediaDurationSec,
  } from '$lib/features/assets/media-timeline-preview';

  export let data: any;
  $: isInline = Boolean((data as any)?.inline);
  $: inputControlLabel =
    data instanceof ClassicPreset.InputControl ? (data as any).controlLabel : undefined;
  $: numberInputMin =
    data instanceof ClassicPreset.InputControl && data.type === 'number'
      ? (data as any).min
      : undefined;
  $: numberInputMax =
    data instanceof ClassicPreset.InputControl && data.type === 'number'
      ? (data as any).max
      : undefined;
  $: numberInputStep =
    data instanceof ClassicPreset.InputControl && data.type === 'number'
      ? ((data as any).step ?? 'any')
      : undefined;
  const graphStateStore = nodeEngine.graphState;
  const isRunningStore = nodeEngine.isRunning;
  const tickTimeStore = nodeEngine.tickTime;
  const midiLearnModeStore = midiNodeBridge.learnMode;
  const midiLastMessageStore = midiService.lastMessage;
  const midiSelectedInputStore = midiService.selectedInputId;
  const midiSupportedStore = midiService.isSupported;

  function changeInput(event: Event) {
    if (!(data instanceof ClassicPreset.InputControl)) return;
    const target = event.target as HTMLInputElement;
    if (data.type === 'number') {
      const num = Number(target.value);
      let next = Number.isFinite(num) ? num : 0;
      const min = (data as any).min;
      const max = (data as any).max;
      if (typeof min === 'number' && Number.isFinite(min)) next = Math.max(min, next);
      if (typeof max === 'number' && Number.isFinite(max)) next = Math.min(max, next);
      if (Number.isFinite(num) && next !== num) target.value = String(next);
      data.setValue(next);
    } else {
      data.setValue(target.value);
    }
  }

  function normalizeNumberInput(event: Event) {
    if (!(data instanceof ClassicPreset.InputControl)) return;
    if (data.type !== 'number') return;
    if ((data as any).readonly) return;

    const target = event.target as HTMLInputElement;
    const raw = target.value;
    if (raw === '') return;

    const num = Number(raw);
    const current = typeof (data as any).value === 'number' ? (data as any).value : 0;

    if (!Number.isFinite(num)) {
      target.value = String(current);
      return;
    }

    let next = num;
    const min = (data as any).min;
    const max = (data as any).max;
    if (typeof min === 'number' && Number.isFinite(min)) next = Math.max(min, next);
    if (typeof max === 'number' && Number.isFinite(max)) next = Math.min(max, next);

    // Force a canonical display string (e.g. "000" -> "0", "01.0" -> "1").
    const canonical = String(next);
    if (target.value !== canonical) target.value = canonical;

    // Ensure the underlying control value matches the canonical/clamped value.
    data.setValue(next);
  }

  function changeSelect(event: Event) {
    const target = event.target as HTMLSelectElement;
    data?.setValue?.(target.value);
  }

  function changeBoolean(event: Event) {
    const target = event.target as HTMLInputElement;
    data?.setValue?.(Boolean(target.checked));
  }

  function pickClient(clientId: string) {
    data?.setValue?.(clientId);
  }

  let didRefreshAssets = false;
  $: if (data?.controlType === 'asset-picker' && !didRefreshAssets) {
    didRefreshAssets = true;
    void assetsStore.refresh();
  }

  let didRefreshLocalMedia = false;
  $: if (data?.controlType === 'local-asset-picker' && !didRefreshLocalMedia) {
    didRefreshLocalMedia = true;
    void localMediaStore.refresh();
  }

  function buildAssetOptions(kind: string): { value: string; label: string }[] {
    const list = ($assetsStore?.assets ?? []) as any[];
    const k = kind && typeof kind === 'string' ? kind : 'any';
    const filtered = k === 'any' ? list : list.filter((a) => String(a?.kind ?? '') === k);
    return filtered.map((a) => ({
      value: String(a?.id ?? ''),
      label: `${String(a?.originalName ?? a?.id ?? '')}`,
      }));
  }

  function buildLocalMediaOptions(kind: string): { value: string; label: string }[] {
    const list = ($localMediaStore?.files ?? []) as any[];
    const k = kind && typeof kind === 'string' ? kind : 'any';
    const filtered = k === 'any' ? list : list.filter((f) => String(f?.kind ?? '') === k);
    return filtered.map((f) => ({
      value: String(f?.path ?? ''),
      label: String(f?.label ?? f?.path ?? ''),
    }));
  }

  function inferLocalKindFromPath(filePath: string): LocalMediaKind | null {
    const lower = filePath.toLowerCase();
    if (/\.(mp3|wav|ogg|m4a|aac|flac|aif|aiff|opus)$/.test(lower)) return 'audio';
    if (/\.(png|jpe?g|gif|webp|bmp|svg)$/.test(lower)) return 'image';
    if (/\.(mp4|webm|mov|m4v)$/.test(lower)) return 'video';
    return null;
  }

  const localAssetKindFromControl = (kindRaw: unknown, fallbackPath: string): LocalMediaKind | null => {
    const normalized = typeof kindRaw === 'string' ? kindRaw.trim().toLowerCase() : '';
    if (normalized === 'audio' || normalized === 'image' || normalized === 'video') return normalized;
    return inferLocalKindFromPath(fallbackPath);
  };

  let localAssetDraft = '';
  let localAssetDraftDirty = false;
  let localAssetError: string | null = null;
  let localAssetValidating = false;

  $: if (data?.controlType === 'local-asset-picker') {
    const current = typeof data?.value === 'string' ? String(data.value) : '';
    if (!localAssetDraftDirty) localAssetDraft = current;
  }

  const changeLocalAssetSelect = (event: Event) => {
    const target = event.target as HTMLSelectElement;
    const next = target.value;
    localAssetDraftDirty = false;
    localAssetDraft = next;
    localAssetError = null;
    data?.setValue?.(next);
  };

  const onLocalAssetDraftInput = (event: Event) => {
    const target = event.target as HTMLInputElement;
    localAssetDraftDirty = true;
    localAssetDraft = target.value;
    localAssetError = null;
  };

  const validateLocalAssetDraft = async () => {
    if (data?.readonly) return;
    const draft = localAssetDraft.trim();
    if (!draft) {
      localAssetDraftDirty = false;
      localAssetError = null;
      data?.setValue?.('');
      return;
    }

    const kind = localAssetKindFromControl((data as any)?.assetKind, draft);
    if (!kind) {
      localAssetError = 'Unsupported file type for this node.';
      return;
    }

    localAssetValidating = true;
    localAssetError = null;
    try {
      const validated = await localMediaStore.validatePath(draft, kind);
      if (!validated?.path) throw new Error('Invalid path');
      localAssetDraftDirty = false;
      localAssetDraft = validated.path;
      data?.setValue?.(validated.path);
    } catch (err) {
      localAssetError = err instanceof Error ? err.message : String(err);
    } finally {
      localAssetValidating = false;
    }
  };

  const onLocalAssetDraftKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void validateLocalAssetDraft();
  };

  const onLocalAssetDraftBlur = () => {
    void validateLocalAssetDraft();
  };

  function clientLabel(c: ClientInfo): string {
    return String((c as any).clientId ?? '');
  }

  function clientSubtitle(c: ClientInfo): string {
    const connectedAt = (c as any).connectedAt;
    if (!connectedAt) return '';
    try {
      const d = new Date(connectedAt);
      return d.toLocaleTimeString(undefined, { hour12: false });
    } catch {
      return '';
    }
  }

	  function readinessClass(clientId: string): string {
	    const info = $clientReadiness.get(clientId);
	    if (!info) return 'connected';
	    if (info.status === 'assets-ready') return 'ready';
	    if (info.status === 'assets-error') return 'error';
	    if (info.status === 'assets-loading') return 'loading';
	    return 'connected';
	  }

	  $: hasLabel = Boolean(data?.label) && !isInline;
	  $: showInputControlLabel = Boolean(inputControlLabel) && !isInline;

	  const clampInt = (value: number, min: number, max: number) => {
	    const next = Math.floor(value);
	    return Math.max(min, Math.min(max, next));
	  };

	  const toFiniteNumber = (value: unknown, fallback: number): number => {
	    const n = typeof value === 'number' ? value : Number(value);
	    return Number.isFinite(n) ? n : fallback;
	  };

	  const coerceBoolean = (value: unknown, fallback = false): boolean => {
	    if (typeof value === 'boolean') return value;
	    if (typeof value === 'number' && Number.isFinite(value)) return value >= 0.5;
	    return fallback;
	  };

	  const hashStringDjb2 = (value: string): number => {
	    let hash = 5381;
	    for (let i = 0; i < value.length; i += 1) {
	      hash = ((hash << 5) + hash + value.charCodeAt(i)) >>> 0;
	    }
	    return hash >>> 0;
	  };

	  const buildStableRandomOrder = (nodeId: string, clients: string[]) => {
	    const keyed = clients.map((id) => ({ id, score: hashStringDjb2(`${nodeId}|${id}`) }));
	    keyed.sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
	    return keyed.map((k) => k.id);
	  };

	  $: clientPickerSelectedIds = (() => {
	    if (data?.controlType !== 'client-picker') return [];
	    const _tick = $tickTimeStore;
	    void _tick;

	    const nodeId = String(data?.nodeId ?? '');
	    if (!nodeId) return [];

	    const clients = ($audienceClients ?? [])
	      .map((c: any) => String(c?.clientId ?? ''))
	      .filter(Boolean);
	    if (clients.length === 0) return [];

	    const node = nodeEngine.getNode(nodeId);
	    if (!node) return [];
	    const computed = nodeEngine.getLastComputedInputs(nodeId);
	    const getComputedOrStoredInput = (portId: string): unknown => {
	      if (computed && Object.prototype.hasOwnProperty.call(computed, portId)) {
	        return (computed as any)[portId];
	      }
	      return (node.inputValues as any)?.[portId];
	    };

	    const total = clients.length;
	    const indexRaw = toFiniteNumber(getComputedOrStoredInput('index'), 1);
	    const rangeRaw = toFiniteNumber(getComputedOrStoredInput('range'), 1);
	    const random = coerceBoolean(getComputedOrStoredInput('random'), false);

	    const index = clampInt(indexRaw, 1, total);
	    const range = clampInt(rangeRaw, 1, total);
	    const ordered = random ? buildStableRandomOrder(nodeId, clients) : clients;

	    const ids: string[] = [];
	    const start = index - 1;
	    for (let i = 0; i < range; i += 1) {
	      ids.push(ordered[(start + i) % total]);
	    }
	    return ids;
	  })();
	  $: clientPickerPrimaryClientId = clientPickerSelectedIds[0] ?? '';
	  $: clientPickerSelectedIdSet = new Set(clientPickerSelectedIds);

  function formatValue(val: number | null | undefined): string {
    if (val === null || val === undefined) return '0.00';
    const num = Number(val);
    if (!Number.isFinite(num)) return '0.00';
    return num.toFixed(2);
  }

  let sensorsClientId = '';
  let sensorsData: any = null;
  let sensorsPayload: any = {};
  let sensorValueText = '--';

  function formatBpm(val: unknown): string {
    if (val === null || val === undefined) return '0';
    const num = Number(val);
    if (!Number.isFinite(num)) return '0';
    return String(Math.round(num));
  }

  function computeSensorValue(portId: string, msg: any, payload: any): string {
    const fallbackNumber = formatValue(0);
    const fallbackBpm = formatBpm(0);
    if (!msg || typeof msg !== 'object') return portId === 'micBpm' ? fallbackBpm : fallbackNumber;

    if (portId === 'accelX')
      return msg.sensorType === 'accel' ? formatValue(payload.x) : fallbackNumber;
    if (portId === 'accelY')
      return msg.sensorType === 'accel' ? formatValue(payload.y) : fallbackNumber;
    if (portId === 'accelZ')
      return msg.sensorType === 'accel' ? formatValue(payload.z) : fallbackNumber;

    const isAngle = msg.sensorType === 'gyro' || msg.sensorType === 'orientation';
    if (portId === 'gyroA') return isAngle ? formatValue(payload.alpha) : fallbackNumber;
    if (portId === 'gyroB') return isAngle ? formatValue(payload.beta) : fallbackNumber;
    if (portId === 'gyroG') return isAngle ? formatValue(payload.gamma) : fallbackNumber;

    if (portId === 'micVol')
      return msg.sensorType === 'mic' ? formatValue(payload.volume) : fallbackNumber;
    if (portId === 'micLow')
      return msg.sensorType === 'mic' ? formatValue(payload.lowEnergy) : fallbackNumber;
    if (portId === 'micHigh')
      return msg.sensorType === 'mic' ? formatValue(payload.highEnergy) : fallbackNumber;
    if (portId === 'micBpm') return msg.sensorType === 'mic' ? formatBpm(payload.bpm) : fallbackBpm;

    return fallbackNumber;
  }

  $: if (data?.controlType === 'client-sensor-value') {
    const nodeId = String(data?.nodeId ?? '');
    const portId = String(data?.portId ?? '');
    const conn = ($graphStateStore.connections ?? []).find(
      (c: any) => c.targetNodeId === nodeId && c.targetPortId === 'client'
    );
    const srcNode = conn
      ? ($graphStateStore.nodes ?? []).find((n: any) => n.id === conn.sourceNodeId)
      : null;
    sensorsClientId = srcNode?.config?.clientId ? String(srcNode.config.clientId) : '';
    sensorsData = sensorsClientId ? $sensorData.get(sensorsClientId) : null;
    sensorsPayload = sensorsData?.payload ?? {};
    sensorValueText = computeSensorValue(portId, sensorsData, sensorsPayload);
  }

  let midiNodeId = '';
  let midiSource: any = null;
  let midiIsLearning = false;

  let fileInput: HTMLInputElement | null = null;
  let fileName = '';
  let fileDisplayLabel = '';
  let fileIsUploading = false;
  let fileUploadError: string | null = null;

  const isFiniteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);

  function openFilePicker() {
    if (data?.readonly) return;
    if (fileIsUploading) return;
    fileInput?.click?.();
  }

  function inferAssetKind(mimeType: string): 'audio' | 'image' | 'video' | null {
    const t = mimeType.toLowerCase();
    if (t.startsWith('audio/')) return 'audio';
    if (t.startsWith('image/')) return 'image';
    if (t.startsWith('video/')) return 'video';
    return null;
  }

  function buildAssetUploadUrl(serverUrl: string): string | null {
    const trimmed = serverUrl.trim();
    if (!trimmed) return null;
    try {
      const base = trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
      return new URL('api/assets', base).toString();
    } catch {
      return null;
    }
  }

  async function uploadFileToAssetService(file: File): Promise<{ assetId: string } | null> {
    const serverUrl = (() => {
      try {
        return localStorage.getItem('shugu-server-url') ?? '';
      } catch {
        return '';
      }
    })();
    const uploadUrl = buildAssetUploadUrl(serverUrl);
    if (!uploadUrl) {
      fileUploadError = 'Invalid server URL (missing shugu-server-url)';
      return null;
    }

    const token = localStorage.getItem('shugu-asset-write-token') ?? '';
    if (!token) {
      fileUploadError = 'Missing Asset Write Token (shugu-asset-write-token)';
      return null;
    }

    const formData = new FormData();
    formData.set('file', file);
    formData.set('originalName', file.name);
    const kind = inferAssetKind(file.type);
    if (kind) formData.set('kind', kind);

    const res = await fetch(uploadUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      fileUploadError = text
        ? `Upload failed (${res.status}): ${text}`
        : `Upload failed (${res.status})`;
      return null;
    }

    const json = (await res.json().catch(() => null)) as any;
    const assetId = String(json?.asset?.id ?? '');
    if (!assetId) {
      fileUploadError = 'Upload failed: invalid response (missing asset.id)';
      return null;
    }
    return { assetId };
  }

  async function handleFileChange(event: Event) {
    if (data?.readonly) return;
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    fileName = file.name;
    fileIsUploading = true;
    fileUploadError = null;

    try {
      const uploaded = await uploadFileToAssetService(file);
      if (!uploaded) return;
      data?.setValue?.(`asset:${uploaded.assetId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      fileUploadError = `Upload failed: ${message}`;
      console.warn('[file-picker] Upload failed', err);
    } finally {
      fileIsUploading = false;
    }
  }

  function formatMidiEvent(event: MidiEvent | null): string {
    if (!event) return '—';
    const channel = `ch${event.channel + 1}`;
    if (event.type === 'pitchbend')
      return `pitchbend • ${channel} • ${event.normalized.toFixed(3)}`;
    const num = event.number ?? 0;
    const suffix = event.type === 'note' ? (event.isPress ? 'on' : 'off') : `${event.rawValue}`;
    return `${event.type} ${num} • ${channel} • ${suffix}`;
  }

  $: if (data?.controlType === 'midi-learn') {
    midiNodeId = String(data?.nodeId ?? '');
    const node = ($graphStateStore.nodes ?? []).find((n: any) => String(n.id) === midiNodeId);
    midiSource = node?.config?.source ?? null;
    midiIsLearning = Boolean(
      $midiLearnModeStore.active && $midiLearnModeStore.nodeId === midiNodeId
    );
  }

  $: fileDisplayLabel =
    data?.controlType === 'file-picker'
      ? fileIsUploading
        ? 'Uploading…'
        : fileName || (typeof data?.value === 'string' && data.value ? 'Loaded' : 'No file')
      : '';

  function toggleMidiLearn(nodeId: string) {
    void midiService.init();
    if (midiIsLearning) {
      midiNodeBridge.cancelLearn();
    } else {
      midiNodeBridge.startLearn(nodeId);
    }
  }

  function clearMidiBinding(nodeId: string) {
    nodeEngine.updateNodeConfig(nodeId, { source: null });
  }

  // ===== time-range control (dual cursor timeline) =====
  let didRefreshAssetsForTimeRange = false;
  $: if (data?.controlType === 'time-range' && !didRefreshAssetsForTimeRange) {
    didRefreshAssetsForTimeRange = true;
    void assetsStore.refresh();
  }

  let timeRangeNodeId = '';
  let timeRangeNodeType = '';
  let timeRangeStartSec = 0;
  let timeRangeEndSec = -1; // -1 means "to end"
  let timeRangeCursorSec = -1; // -1 means "unset"
  let timeRangeMin = 0;
  let timeRangeMax = 10;
  let timeRangeStep = 0.01;
  let timeRangeDurationSec: number | null = null;
  let timeRangeBackdropUrl: string | null = null;
  let timeRangeSliderStart = 0;
  let timeRangeSliderEnd = 0;
  let timeRangeSliderCursor = 0;
  let timeRangeStartPct = 0;
  let timeRangeEndPct = 100;
  let timeRangeCursorPct = 0;
  let timeRangeStartFrac = 0;
  let timeRangeEndFrac = 1;
  let timeRangeCursorFrac = 0;
  let timeRangeEffectiveEndSec: number | null = null;

  const secondsFormatter = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
    useGrouping: false,
  });

  const formatSeconds = (value: number | null | undefined): string => {
    if (value === null || value === undefined) return '—';
    const num = Number(value);
    if (!Number.isFinite(num)) return '—';
    const rounded = Math.round(num * 100) / 100;
    return secondsFormatter.format(rounded);
  };

  const buildAssetContentUrl = (serverUrl: string, assetId: string): string | null => {
    const trimmed = serverUrl.trim();
    const id = assetId.trim();
    if (!trimmed || !id) return null;
    try {
      const base = trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
      return new URL(`api/assets/${encodeURIComponent(id)}/content`, base).toString();
    } catch {
      return null;
    }
  };

  const buildLocalMediaContentUrl = (
    serverUrl: string,
    filePath: string,
    kind: LocalMediaKind
  ): string | null => {
    const trimmed = serverUrl.trim();
    const p = filePath.trim();
    if (!trimmed || !p) return null;
    try {
      const base = trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
      const url = new URL('api/local-media/content', base);
      url.searchParams.set('path', p);
      url.searchParams.set('kind', kind);
      const token = localStorage.getItem('shugu-asset-read-token') ?? '';
      if (token.trim()) url.searchParams.set('token', token.trim());
      return url.toString();
    } catch {
      return null;
    }
  };

  const resolveConnectedNumber = (nodeId: string, portId: string): number | null => {
    const conn = ($graphStateStore.connections ?? []).find(
      (c: any) => String(c.targetNodeId) === nodeId && String(c.targetPortId) === portId
    );
    if (!conn) return null;
    const src = nodeEngine.getNode(String(conn.sourceNodeId));
    const raw = src?.outputValues?.[String(conn.sourcePortId)];
    const num = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(num) ? num : null;
  };

  const readLocalNumber = (node: any, key: string): number | null => {
    const raw = node?.inputValues?.[key];
    const num = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(num) ? num : null;
  };

  const resolveConnectedBoolean = (nodeId: string, portId: string): boolean | null => {
    const conn = ($graphStateStore.connections ?? []).find(
      (c: any) => String(c.targetNodeId) === nodeId && String(c.targetPortId) === portId
    );
    if (!conn) return null;
    const src = nodeEngine.getNode(String(conn.sourceNodeId));
    const raw = src?.outputValues?.[String(conn.sourcePortId)];
    if (typeof raw === 'boolean') return raw;
    const num = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(num) ? num >= 0.5 : null;
  };

  const computeEffectiveRange = (
    nodeId: string
  ): { startSec: number; endSec: number; cursorSec: number } => {
    const node = nodeEngine.getNode(nodeId);
    const startRaw =
      resolveConnectedNumber(nodeId, 'startSec') ?? readLocalNumber(node, 'startSec') ?? 0;
    const endRaw =
      resolveConnectedNumber(nodeId, 'endSec') ?? readLocalNumber(node, 'endSec') ?? -1;
    const cursorRaw =
      resolveConnectedNumber(nodeId, 'cursorSec') ?? readLocalNumber(node, 'cursorSec') ?? -1;

    const startSec = Math.max(0, startRaw);
    const endSec = endRaw >= 0 ? Math.max(startSec, endRaw) : -1;
    const cursorSec = cursorRaw >= 0 ? Math.max(0, cursorRaw) : -1;
    return { startSec, endSec, cursorSec };
  };

  let timeRangeIsPlaying = false;
  let timeRangeLoopEnabled = false;
  let timeRangeReverseEnabled = false;
  let timeRangePlaybackRaf: number | null = null;
  let timeRangePlaybackCursorSec = 0;
  let timeRangePlaybackLastMs = 0;
  // For media nodes, the UI playhead should only advance after we receive a client "started" signal.
  let timeRangeLastPlayRequested: boolean | null = null;
  let timeRangeStartSeqBase: number | null = null;
  let timeRangeSignalNodeId = '';
  let timeRangePlayheadLastReportMs = 0;
  let timeRangeLastReportedCursorSec: number | null = null;

  const TIME_RANGE_PLAYHEAD_REPORT_INTERVAL_MS = 250;

  const reportTimeRangePlayhead = (cursorSec: number, nowMs: number) => {
    if (!timeRangeNodeId) return;
    if (
      timeRangeNodeType !== 'load-audio-from-assets' &&
      timeRangeNodeType !== 'load-video-from-assets' &&
      timeRangeNodeType !== 'load-audio-from-local' &&
      timeRangeNodeType !== 'load-video-from-local'
    ) {
      return;
    }
    if (!Number.isFinite(cursorSec) || cursorSec < 0) return;
    if (nowMs - timeRangePlayheadLastReportMs < TIME_RANGE_PLAYHEAD_REPORT_INTERVAL_MS) return;
    timeRangePlayheadLastReportMs = nowMs;

    // Round to avoid noisy updates while still keeping patch retargets in sync.
    const rounded = Math.round(cursorSec * 1000) / 1000;
    if (
      timeRangeLastReportedCursorSec !== null &&
      Math.abs(rounded - timeRangeLastReportedCursorSec) < 0.001
    ) {
      return;
    }
    timeRangeLastReportedCursorSec = rounded;
    nodeEngine.setTimeRangePlayheadSec(timeRangeNodeId, rounded);
  };

  const clearTimeRangePlayhead = () => {
    if (timeRangeNodeId) nodeEngine.setTimeRangePlayheadSec(timeRangeNodeId, null);
    timeRangePlayheadLastReportMs = 0;
    timeRangeLastReportedCursorSec = null;
  };

  const syncTimeRangeUi = (values: { startSec: number; endSec: number; cursorSec: number }) => {
    timeRangeStartSec = values.startSec;
    timeRangeEndSec = values.endSec;
    timeRangeCursorSec = values.cursorSec;

    const maxFromAsset = timeRangeDurationSec;
    const maxFromField = isFiniteNumber((data as any).max) ? Number((data as any).max) : null;
    const maxFallback = Math.max(
      10,
      timeRangeStartSec,
      timeRangeEndSec > 0 ? timeRangeEndSec : 0,
      timeRangeCursorSec > 0 ? timeRangeCursorSec : 0
    );
    timeRangeMax = Math.max(
      timeRangeMin + timeRangeStep,
      maxFromAsset ?? maxFromField ?? maxFallback
    );

    const clamp = (v: number) => Math.max(timeRangeMin, Math.min(timeRangeMax, v));
    timeRangeSliderStart = clamp(timeRangeStartSec);
    timeRangeEffectiveEndSec =
      timeRangeEndSec < 0 ? (timeRangeDurationSec ?? null) : timeRangeEndSec;
    timeRangeSliderEnd = timeRangeEndSec < 0 ? timeRangeMax : clamp(timeRangeEndSec);
    if (timeRangeSliderEnd < timeRangeSliderStart) timeRangeSliderEnd = timeRangeSliderStart;

    const cursorFallback = timeRangeCursorSec >= 0 ? timeRangeCursorSec : timeRangeStartSec;
    const nextCursor = clamp(cursorFallback);
    if (!timeRangeIsPlaying) {
      timeRangeSliderCursor = nextCursor;
      timeRangePlaybackCursorSec = nextCursor;
    }
    if (timeRangeSliderCursor < timeRangeSliderStart) timeRangeSliderCursor = timeRangeSliderStart;
    if (timeRangeSliderCursor > timeRangeSliderEnd) timeRangeSliderCursor = timeRangeSliderEnd;

    const span = timeRangeMax - timeRangeMin;
    timeRangeStartFrac = span > 0 ? (timeRangeSliderStart - timeRangeMin) / span : 0;
    timeRangeEndFrac = span > 0 ? (timeRangeSliderEnd - timeRangeMin) / span : 1;
    timeRangeCursorFrac = span > 0 ? (timeRangeSliderCursor - timeRangeMin) / span : 0;

    timeRangeStartPct = timeRangeStartFrac * 100;
    timeRangeEndPct = timeRangeEndFrac * 100;
    timeRangeCursorPct = timeRangeCursorFrac * 100;
  };

  function stopTimeRangePlayback(): void {
    if (timeRangePlaybackRaf !== null) {
      cancelAnimationFrame(timeRangePlaybackRaf);
      timeRangePlaybackRaf = null;
    }
    timeRangePlaybackLastMs = 0;
    clearTimeRangePlayhead();
  }

  function startTimeRangePlayback(): void {
    stopTimeRangePlayback();
    timeRangePlaybackCursorSec = timeRangeCursorSec >= 0 ? timeRangeCursorSec : timeRangeStartSec;
    timeRangePlaybackLastMs = performance.now();
    reportTimeRangePlayhead(timeRangePlaybackCursorSec, timeRangePlaybackLastMs);

    const frame = (nowMs: number) => {
      const dt = Math.max(0, nowMs - timeRangePlaybackLastMs);
      timeRangePlaybackLastMs = nowMs;

      const start = timeRangeStartSec;
      const endRaw =
        timeRangeEndSec < 0 ? (timeRangeEffectiveEndSec ?? timeRangeMax) : timeRangeEndSec;
      const end = Math.max(start, endRaw);
      const span = Math.max(0.0001, end - start);

      const dir = timeRangeReverseEnabled ? -1 : 1;
      timeRangePlaybackCursorSec += (dir * dt) / 1000;

      if (!timeRangeLoopEnabled) {
        timeRangePlaybackCursorSec = Math.max(start, Math.min(end, timeRangePlaybackCursorSec));
      } else {
        while (timeRangePlaybackCursorSec > end) timeRangePlaybackCursorSec -= span;
        while (timeRangePlaybackCursorSec < start) timeRangePlaybackCursorSec += span;
      }

      // UI-only playhead: do not write back to node inputs (avoid spamming overrides).
      timeRangeSliderCursor = Math.max(
        timeRangeSliderStart,
        Math.min(timeRangeSliderEnd, timeRangePlaybackCursorSec)
      );
      const fullSpan = timeRangeMax - timeRangeMin;
      timeRangeCursorFrac = fullSpan > 0 ? (timeRangeSliderCursor - timeRangeMin) / fullSpan : 0;
      timeRangeCursorPct = timeRangeCursorFrac * 100;
      reportTimeRangePlayhead(timeRangeSliderCursor, nowMs);

      if (timeRangeIsPlaying) {
        timeRangePlaybackRaf = requestAnimationFrame(frame);
      } else {
        stopTimeRangePlayback();
      }
    };

    timeRangePlaybackRaf = requestAnimationFrame(frame);
  }

  onDestroy(() => {
    stopTimeRangePlayback();
  });

  let lastTimelineAssetId = '';
  let lastTimelineUrl = '';

  $: if (data?.controlType === 'time-range') {
    // Read tickTime so this block re-runs when node state changes (input edits, runtime ticks, etc.).
    // (We don't use the value; it's purely an invalidation dependency.)
    const _tick = $tickTimeStore;
    void _tick;

    // Also re-evaluate playhead state when the engine starts/stops.
    const isEngineRunning = $isRunningStore;
    void isEngineRunning;

    timeRangeNodeId = String(data?.nodeId ?? '');
    timeRangeNodeType = String(data?.nodeType ?? '');

    if (timeRangeNodeId !== timeRangeSignalNodeId) {
      timeRangeSignalNodeId = timeRangeNodeId;
      timeRangeLastPlayRequested = null;
      timeRangeStartSeqBase = null;
    }

    const { startSec, endSec, cursorSec } = computeEffectiveRange(timeRangeNodeId);

    timeRangeMin = isFiniteNumber((data as any).min) ? Number((data as any).min) : 0;
    timeRangeStep = isFiniteNumber((data as any).step) ? Number((data as any).step) : 0.01;

    const runtimeNode = timeRangeNodeId ? nodeEngine.getNode(timeRangeNodeId) : null;
    const assetIdRaw = typeof (runtimeNode as any)?.config?.assetId === 'string' ? String((runtimeNode as any).config.assetId) : '';
    const assetId = assetIdRaw.trim();

    const localAssetPathRaw =
      typeof (runtimeNode as any)?.config?.assetPath === 'string'
        ? String((runtimeNode as any).config.assetPath)
        : '';
    const localAssetPath = localAssetPathRaw.trim();

    // Refresh duration/backdrop when the asset changes.
    const timelineAssetKey =
      timeRangeNodeType === 'load-audio-from-assets' || timeRangeNodeType === 'load-video-from-assets'
        ? assetId
        : localAssetPath;

    if (timelineAssetKey !== lastTimelineAssetId) {
      lastTimelineAssetId = timelineAssetKey;
      timeRangeDurationSec = null;
      timeRangeBackdropUrl = null;
      lastTimelineUrl = '';
    }

    const serverUrl = localStorage.getItem('shugu-server-url') ?? '';
    const contentUrl = (() => {
      if (timeRangeNodeType === 'load-audio-from-assets' || timeRangeNodeType === 'load-video-from-assets') {
        return assetId ? buildAssetContentUrl(serverUrl, assetId) : null;
      }
      const kind: LocalMediaKind | null =
        timeRangeNodeType === 'load-video-from-local'
          ? 'video'
          : timeRangeNodeType === 'load-audio-from-local'
            ? 'audio'
            : null;
      if (!kind) return null;
      return localAssetPath ? buildLocalMediaContentUrl(serverUrl, localAssetPath, kind) : null;
    })();

    if (contentUrl && contentUrl !== lastTimelineUrl) {
      lastTimelineUrl = contentUrl;
      void (async () => {
        const kind: any =
          timeRangeNodeType === 'load-video-from-assets' || timeRangeNodeType === 'load-video-from-local'
            ? 'video'
            : 'audio';
        const duration = await getMediaDurationSec(contentUrl, kind);
        if (duration !== null && contentUrl === lastTimelineUrl) {
          timeRangeDurationSec = duration;
        }
        if (kind === 'audio') {
          const bg = await getAudioSpectrogramDataUrl(contentUrl, {
            width: 360,
            height: 84,
            fftSize: 1024,
          });
          if (bg && contentUrl === lastTimelineUrl) timeRangeBackdropUrl = bg;
        }
      })();
    }

    // UI playhead: detect play/loop/reverse from node inputs (or connected overrides).
    const playRaw =
      resolveConnectedBoolean(timeRangeNodeId, 'play') ??
      (() => {
        const raw = (runtimeNode as any)?.inputValues?.play;
        if (typeof raw === 'boolean') return raw;
        const num = typeof raw === 'number' ? raw : Number(raw);
        return Number.isFinite(num) ? num >= 0.5 : false;
      })();
    const loopRaw =
      resolveConnectedBoolean(timeRangeNodeId, 'loop') ??
      (() => {
        const raw = (runtimeNode as any)?.inputValues?.loop;
        if (typeof raw === 'boolean') return raw;
        const num = typeof raw === 'number' ? raw : Number(raw);
        return Number.isFinite(num) ? num >= 0.5 : false;
      })();
    const reverseRaw =
      resolveConnectedBoolean(timeRangeNodeId, 'reverse') ??
      (() => {
        const raw = (runtimeNode as any)?.inputValues?.reverse;
        if (typeof raw === 'boolean') return raw;
        const num = typeof raw === 'number' ? raw : Number(raw);
        return Number.isFinite(num) ? num >= 0.5 : false;
      })();

    timeRangeIsPlaying = Boolean(playRaw);
    timeRangeLoopEnabled = Boolean(loopRaw);
    timeRangeReverseEnabled = Boolean(reverseRaw);
    if (
      timeRangeNodeType === 'load-audio-from-assets' ||
      timeRangeNodeType === 'load-video-from-assets' ||
      timeRangeNodeType === 'load-audio-from-local' ||
      timeRangeNodeType === 'load-video-from-local'
    ) {
      const inputHasAsset = ($graphStateStore.connections ?? []).some(
        (c: any) => String(c.targetNodeId) === timeRangeNodeId && String(c.targetPortId) === 'asset'
      );
      const localInputValue =
        typeof (runtimeNode as any)?.inputValues?.asset === 'string' ? String((runtimeNode as any).inputValues.asset).trim() : '';

      const hasAsset =
        timeRangeNodeType === 'load-audio-from-assets' || timeRangeNodeType === 'load-video-from-assets'
          ? Boolean(assetId)
          : Boolean(localAssetPath || localInputValue || inputHasAsset);
      // Require a client "started" signal so the cursor only advances when playback actually begins.
      const signal = $nodeMediaSignals.get(timeRangeNodeId);
      const startedSeq = typeof signal?.startedSeq === 'number' ? signal.startedSeq : 0;

      const playRequested = Boolean(playRaw);
      if (timeRangeLastPlayRequested === null) {
        timeRangeLastPlayRequested = playRequested;
        timeRangeStartSeqBase = playRequested ? 0 : null;
      } else if (!playRequested) {
        timeRangeLastPlayRequested = false;
        timeRangeStartSeqBase = null;
      } else if (playRequested && !timeRangeLastPlayRequested) {
        timeRangeLastPlayRequested = true;
        timeRangeStartSeqBase = startedSeq;
      }

      const needsStartedSeq = timeRangeStartSeqBase ?? 0;
      const hasStartedSignal = playRequested && startedSeq > needsStartedSeq;

      timeRangeIsPlaying = timeRangeIsPlaying && hasAsset && Boolean(isEngineRunning) && hasStartedSignal;
    }

    syncTimeRangeUi({ startSec, endSec, cursorSec });
  }

  $: if (data?.controlType === 'time-range') {
    if (timeRangeIsPlaying) {
      if (timeRangePlaybackRaf === null) startTimeRangePlayback();
    } else {
      stopTimeRangePlayback();
    }
  } else {
    stopTimeRangePlayback();
  }

  const setTimeRange = (startSec: number, endSec: number, cursorSec: number) => {
    if (data?.readonly) return;
    const start = Math.max(timeRangeMin, startSec);
    const end = endSec >= 0 ? Math.max(start, endSec) : -1;
    const cursor = cursorSec >= 0 ? Math.max(start, cursorSec) : -1;
    (data as any)?.setValue?.({ startSec: start, endSec: end, cursorSec: cursor });
  };

  const handleTimeRangeStartSlider = (event: Event) => {
    const target = event.target as HTMLInputElement;
    const n = Number(target.value);
    if (!Number.isFinite(n)) return;
    const nextStart = Math.max(timeRangeMin, n);
    const nextEnd = timeRangeEndSec >= 0 ? Math.max(nextStart, timeRangeEndSec) : -1;
    const nextCursor =
      timeRangeCursorSec >= 0
        ? Math.max(nextStart, Math.min(timeRangeSliderEnd, timeRangeSliderCursor))
        : -1;
    syncTimeRangeUi({ startSec: nextStart, endSec: nextEnd, cursorSec: nextCursor });
    setTimeRange(nextStart, nextEnd, nextCursor);
  };

  const handleTimeRangeEndSlider = (event: Event) => {
    const target = event.target as HTMLInputElement;
    const n = Number(target.value);
    if (!Number.isFinite(n)) return;
    const nearEnd = Math.abs(n - timeRangeMax) <= timeRangeStep * 0.5;
    const nextEnd = nearEnd ? -1 : Math.max(timeRangeStartSec, Math.max(timeRangeMin, n));
    const nextCursor =
      timeRangeCursorSec >= 0
        ? Math.min(
            nextEnd >= 0 ? nextEnd : timeRangeMax,
            Math.max(timeRangeStartSec, timeRangeSliderCursor)
          )
        : -1;
    syncTimeRangeUi({ startSec: timeRangeStartSec, endSec: nextEnd, cursorSec: nextCursor });
    setTimeRange(timeRangeStartSec, nextEnd, nextCursor);
  };

  const handleTimeRangeCursorSlider = (event: Event) => {
    const target = event.target as HTMLInputElement;
    const n = Number(target.value);
    if (!Number.isFinite(n)) return;
    const next = Math.max(timeRangeStartSec, Math.min(timeRangeSliderEnd, n));
    timeRangePlaybackCursorSec = next;
    timeRangeSliderCursor = next;
    const span = timeRangeMax - timeRangeMin;
    timeRangeCursorFrac = span > 0 ? (timeRangeSliderCursor - timeRangeMin) / span : 0;
    timeRangeCursorPct = timeRangeCursorFrac * 100;
    setTimeRange(timeRangeStartSec, timeRangeEndSec, next);
  };
</script>

{#if data instanceof ClassicPreset.InputControl}
  <div class="control-field {isInline ? 'inline' : ''}">
    {#if showInputControlLabel}
      <div class="control-label">{inputControlLabel}</div>
    {/if}
    <input
      class="control-input {isInline ? 'inline' : ''}"
      type={data.type}
      value={data.value}
      min={numberInputMin}
      max={numberInputMax}
      step={numberInputStep}
      readonly={data.readonly}
      disabled={data.readonly}
      on:pointerdown|stopPropagation
      on:input={changeInput}
      on:blur={normalizeNumberInput}
    />
  </div>
{:else if data?.controlType === 'select'}
  <div class="control-field {isInline ? 'inline' : ''}">
    {#if hasLabel}
      <div class="control-label">{data.label}</div>
    {/if}
    <select
      class="control-input {isInline ? 'inline' : ''}"
      value={data.value}
      disabled={data.readonly}
      on:pointerdown|stopPropagation
      on:change={changeSelect}
    >
      {#if data.placeholder}
        <option value="">{data.placeholder}</option>
      {/if}
      {#each data.options ?? [] as opt (opt.value)}
        <option value={opt.value}>{opt.label}</option>
      {/each}
    </select>
  </div>
{:else if data?.controlType === 'boolean'}
  <div class="control-field boolean-field {isInline ? 'inline' : ''}">
    <label class="toggle {isInline ? 'inline' : ''}" on:pointerdown|stopPropagation>
      <input
        type="checkbox"
        checked={Boolean(data.value)}
        disabled={data.readonly}
        on:change={changeBoolean}
      />
      <span class="toggle-track">
        <span class="toggle-thumb"></span>
      </span>
      {#if hasLabel}
        <span class="toggle-label">{data.label}</span>
      {/if}
    </label>
  </div>
{:else if data?.controlType === 'time-range'}
  <div class="time-range {isInline ? 'inline' : ''}">
    {#if hasLabel}
      <div class="control-label">{data.label}</div>
    {/if}

    <div class="time-range-row">
      <div class="time-range-kv" aria-hidden="true">
        <div class="time-range-k">Start</div>
        <div class="time-range-v">{formatSeconds(timeRangeStartSec)}s</div>
      </div>

      <div class="time-range-kv" aria-hidden="true">
        <div class="time-range-k">End</div>
        <div class="time-range-v">
          {#if timeRangeEffectiveEndSec !== null}
            {formatSeconds(timeRangeEffectiveEndSec)}s
          {:else if timeRangeEndSec < 0}
            (end)
          {:else}
            {formatSeconds(timeRangeEndSec)}s
          {/if}
        </div>
      </div>

      <div class="time-range-kv" aria-hidden="true">
        <div class="time-range-k">Duration</div>
        <div class="time-range-v">
          {#if timeRangeDurationSec !== null}
            {formatSeconds(timeRangeDurationSec)}s
          {:else}
            —
          {/if}
        </div>
      </div>

      <div class="time-range-kv" aria-hidden="true">
        <div class="time-range-k">Current</div>
        <div class="time-range-v">{formatSeconds(timeRangeSliderCursor)}s</div>
      </div>
    </div>

    <div
      class="time-range-slider"
      on:pointerdown|stopPropagation
      style="background-image: {timeRangeBackdropUrl ? `url("${timeRangeBackdropUrl}")` : 'none'};"
    >
      <div
        class="time-range-highlight"
        style="left: calc(10px + (100% - 20px) * {timeRangeStartFrac}); width: calc((100% - 20px) * {Math.max(
          0,
          timeRangeEndFrac - timeRangeStartFrac
        )});"
      />
      <div
        class="time-range-cursor"
        style="left: calc(10px + (100% - 20px) * {timeRangeCursorFrac});"
        aria-hidden="true"
      />
      <input
        class="time-range-slider-input start"
        type="range"
        min={timeRangeMin}
        max={timeRangeMax}
        step={timeRangeStep}
        value={timeRangeSliderStart}
        disabled={data.readonly}
        on:input={handleTimeRangeStartSlider}
      />
      <input
        class="time-range-slider-input end"
        type="range"
        min={timeRangeMin}
        max={timeRangeMax}
        step={timeRangeStep}
        value={timeRangeSliderEnd}
        disabled={data.readonly}
        on:input={handleTimeRangeEndSlider}
      />
      <input
        class="time-range-slider-input cursor"
        type="range"
        min={timeRangeMin}
        max={timeRangeMax}
        step={timeRangeStep}
        value={timeRangeSliderCursor}
        disabled={data.readonly}
        on:input={handleTimeRangeCursorSlider}
      />
    </div>
  </div>
{:else if data?.controlType === 'file-picker'}
  <div class="file-picker {isInline ? 'inline' : ''}">
    {#if hasLabel}
      <div class="control-label">{data.label}</div>
    {/if}
    <div class="file-row">
      <button
        type="button"
        class="file-btn"
        disabled={data.readonly || fileIsUploading}
        on:pointerdown|stopPropagation
        on:click|stopPropagation={openFilePicker}
      >
        {data.buttonLabel || 'Choose file'}
      </button>
      <div class="file-name">{fileDisplayLabel}</div>
    </div>
    {#if fileUploadError}
      <div class="file-error">{fileUploadError}</div>
    {/if}
    <input
      class="file-input"
      type="file"
      accept={data.accept}
      bind:this={fileInput}
      disabled={data.readonly || fileIsUploading}
      on:pointerdown|stopPropagation
      on:change={handleFileChange}
    />
  </div>
{:else if data?.controlType === 'client-picker'}
  <div class="client-picker">
    {#if hasLabel}
      <div class="control-label">{data.label}</div>
    {/if}
    {#if ($audienceClients ?? []).length === 0}
      <div class="client-empty">No clients connected</div>
    {:else}
      <div class="client-list">
        {#each $audienceClients as c (c.clientId)}
          <button
            type="button"
	            class="client-item {c.clientId === clientPickerPrimaryClientId
	              ? 'selected'
	              : clientPickerSelectedIdSet.has(c.clientId)
	                ? 'in-range'
	                : ''}"
            disabled={data.readonly}
            on:pointerdown|stopPropagation
            on:click|stopPropagation={() => pickClient(c.clientId)}
          >
            <span class="client-dot {readinessClass(c.clientId)}"></span>
            <span class="client-main">
              <span class="client-id">{clientLabel(c)}</span>
              <span class="client-time">{clientSubtitle(c)}</span>
            </span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
{:else if data?.controlType === 'asset-picker'}
  <div class="control-field {isInline ? 'inline' : ''}">
    {#if hasLabel}
      <div class="control-label">{data.label}</div>
    {/if}
    <select
      class="control-input {isInline ? 'inline' : ''}"
      value={data.value}
      disabled={data.readonly}
      on:pointerdown|stopPropagation
      on:change={changeSelect}
    >
      <option value="">(select asset)</option>
      {#each buildAssetOptions(data.assetKind) as opt (opt.value)}
        <option value={opt.value}>{opt.label}</option>
      {/each}
    </select>
  </div>
{:else if data?.controlType === 'local-asset-picker'}
  <div class="local-asset-picker {isInline ? 'inline' : ''}">
    {#if hasLabel}
      <div class="control-label">{data.label}</div>
    {/if}

    <select
      class="control-input {isInline ? 'inline' : ''}"
      value={data.value}
      disabled={data.readonly || localAssetValidating}
      on:pointerdown|stopPropagation
      on:change={changeLocalAssetSelect}
    >
      <option value="">(select local file)</option>
      {#each buildLocalMediaOptions(data.assetKind) as opt (opt.value)}
        <option value={opt.value}>{opt.label}</option>
      {/each}
    </select>

    <div class="local-asset-path-row">
      <input
        class="control-input local-asset-path"
        value={localAssetDraft}
        placeholder="/Users/.../file.mp4"
        disabled={data.readonly || localAssetValidating}
        on:pointerdown|stopPropagation
        on:input={onLocalAssetDraftInput}
        on:keydown={onLocalAssetDraftKeyDown}
        on:blur={onLocalAssetDraftBlur}
      />
      <button
        type="button"
        class="local-asset-btn"
        disabled={data.readonly || localAssetValidating}
        on:pointerdown|stopPropagation
        on:click|stopPropagation={() => validateLocalAssetDraft()}
      >
        {localAssetValidating ? 'Checking…' : 'Check'}
      </button>
    </div>

    {#if $localMediaStore?.status === 'error' && $localMediaStore?.error}
      <div class="local-asset-hint">Local media list error: {$localMediaStore.error}</div>
    {/if}
    {#if localAssetError}
      <div class="local-asset-error">{localAssetError}</div>
    {/if}
  </div>
{:else if data?.controlType === 'client-sensor-value'}
  <div class="sensor-inline-value">{sensorValueText}</div>
{:else if data?.controlType === 'midi-learn'}
  <div class="midi-learn">
    {#if hasLabel}
      <div class="control-label">{data.label}</div>
    {/if}
    <div class="midi-row">
      <div class="midi-binding">{formatMidiSource(midiSource)}</div>
      <button
        type="button"
        class="midi-btn {midiIsLearning ? 'active' : ''}"
        disabled={!$midiSupportedStore}
        on:pointerdown|stopPropagation
        on:click|stopPropagation={() => toggleMidiLearn(midiNodeId)}
      >
        {midiIsLearning ? 'Listening…' : 'Learn'}
      </button>
    </div>
    {#if midiIsLearning}
      <div class="midi-hint">
        Move a MIDI control… (input: {$midiSelectedInputStore || 'auto'})
      </div>
      <div class="midi-last">{formatMidiEvent($midiLastMessageStore)}</div>
    {/if}
    {#if midiSource}
      <button
        type="button"
        class="midi-clear"
        on:pointerdown|stopPropagation
        on:click|stopPropagation={() => clearMidiBinding(midiNodeId)}
      >
        Clear binding
      </button>
    {/if}
  </div>
{:else}
  <div class="control-unknown">Unsupported control</div>
{/if}

<style>
  .control-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px 10px;
  }

  .control-field.inline {
    flex-direction: row;
    align-items: center;
    justify-content: flex-end;
    gap: 0;
    padding: 0;
  }

  .control-label {
    font-size: 11px;
    letter-spacing: 0.2px;
    color: rgba(255, 255, 255, 0.72);
  }

  .control-input {
    width: 100%;
    box-sizing: border-box;
    border-radius: 10px;
    padding: 6px 10px;
    background: rgba(2, 6, 23, 0.45);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.92);
    outline: none;
    font-size: 12px;
  }

  select.control-input {
    appearance: auto;
    -webkit-appearance: menulist;
  }

  .control-input.inline {
    width: 110px;
    padding: 5px 8px;
  }

  .control-input:focus {
    border-color: rgba(99, 102, 241, 0.7);
    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.18);
  }

  .control-input:disabled,
  .control-input[readonly] {
    background: rgba(2, 6, 23, 0.22);
    border-color: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.58);
    cursor: not-allowed;
  }

  .local-asset-picker {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 6px 10px 10px;
  }

  .local-asset-path-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .local-asset-path {
    flex: 1;
    min-width: 0;
  }

  .local-asset-btn {
    border-radius: 10px;
    padding: 6px 10px;
    background: rgba(2, 6, 23, 0.45);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.85);
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
  }

  .local-asset-btn:hover:not(:disabled) {
    border-color: rgba(99, 102, 241, 0.7);
    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.12);
  }

  .local-asset-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .local-asset-error,
  .local-asset-hint {
    font-size: 11px;
    line-height: 1.3;
    color: rgba(248, 113, 113, 0.92);
    overflow-wrap: anywhere;
  }

  .local-asset-hint {
    color: rgba(148, 163, 184, 0.8);
  }

  .control-input:disabled:focus,
  .control-input[readonly]:focus {
    border-color: rgba(255, 255, 255, 0.12);
    box-shadow: none;
  }

  .boolean-field {
    padding-top: 8px;
    padding-bottom: 8px;
  }

  .boolean-field.inline {
    padding-top: 0;
    padding-bottom: 0;
  }

  .toggle {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    user-select: none;
  }

  .toggle.inline {
    gap: 0;
  }

  .toggle input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }

  .toggle-track {
    width: 34px;
    height: 18px;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    background: rgba(255, 255, 255, 0.08);
    display: inline-flex;
    align-items: center;
    padding: 2px;
    box-sizing: border-box;
    transition:
      background 120ms ease,
      border-color 120ms ease;
  }

  .toggle-thumb {
    width: 14px;
    height: 14px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.78);
    transform: translateX(0);
    transition:
      transform 120ms ease,
      background 120ms ease;
  }

  .toggle input:checked + .toggle-track {
    background: rgba(99, 102, 241, 0.35);
    border-color: rgba(99, 102, 241, 0.55);
  }

  .toggle input:checked + .toggle-track .toggle-thumb {
    transform: translateX(16px);
    background: rgba(255, 255, 255, 0.9);
  }

  .toggle input:disabled + .toggle-track {
    opacity: 0.45;
  }

  .toggle input:disabled ~ .toggle-label {
    opacity: 0.65;
    cursor: not-allowed;
  }

  .toggle-label {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.84);
  }

  .time-range {
    padding: 6px 10px 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .time-range-row {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    align-items: end;
  }

  .time-range-kv {
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(2, 6, 23, 0.25);
    border-radius: 10px;
    padding: 6px 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .time-range-k {
    font-size: 10px;
    letter-spacing: 0.2px;
    color: rgba(255, 255, 255, 0.55);
  }

  .time-range-v {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 650;
    color: rgba(255, 255, 255, 0.9);
    line-height: 1.25;
    overflow-wrap: anywhere;
  }

  .time-range-slider {
    position: relative;
    height: 84px;
    padding: 0 2px;
    border-radius: 10px;
    background-color: rgba(2, 6, 23, 0.35);
    border: 1px solid rgba(255, 255, 255, 0.1);
    display: flex;
    align-items: center;
    overflow: hidden;
    background-size: cover;
    background-position: center;
  }

  .time-range-highlight {
    position: absolute;
    height: 6px;
    border-radius: 999px;
    background: rgba(14, 165, 233, 0.7);
    bottom: 10px;
    pointer-events: none;
  }

  .time-range-cursor {
    position: absolute;
    top: 8px;
    bottom: 8px;
    width: 2px;
    background: rgba(255, 255, 255, 0.85);
    box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.35);
    pointer-events: none;
  }

  .time-range-slider-input {
    -webkit-appearance: none;
    appearance: none;
    position: absolute;
    left: 10px;
    right: 10px;
    width: calc(100% - 20px);
    height: 84px;
    background: transparent;
    pointer-events: none;
  }

  .time-range-slider-input::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    pointer-events: auto;
    width: 16px;
    height: 16px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.92);
    border: 2px solid rgba(14, 165, 233, 0.95);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
  }

  .time-range-slider-input::-moz-range-thumb {
    pointer-events: auto;
    width: 16px;
    height: 16px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.92);
    border: 2px solid rgba(14, 165, 233, 0.95);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
  }

  .time-range-slider-input::-webkit-slider-runnable-track {
    height: 6px;
    background: rgba(255, 255, 255, 0.12);
    border-radius: 999px;
  }

  .time-range-slider-input::-moz-range-track {
    height: 6px;
    background: rgba(255, 255, 255, 0.12);
    border-radius: 999px;
  }

  .time-range-slider-input.cursor::-webkit-slider-thumb {
    width: 10px;
    height: 18px;
    border-radius: 6px;
    border-color: rgba(255, 255, 255, 0.9);
    background: rgba(255, 255, 255, 0.9);
  }

  .time-range-slider-input.cursor::-moz-range-thumb {
    width: 10px;
    height: 18px;
    border-radius: 6px;
    border-color: rgba(255, 255, 255, 0.9);
    background: rgba(255, 255, 255, 0.9);
  }

  .client-picker {
    padding: 6px 8px 10px;
  }

  .file-picker {
    padding: 6px 10px 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .file-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .file-btn {
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(2, 6, 23, 0.5);
    color: rgba(255, 255, 255, 0.88);
    padding: 6px 10px;
    font-size: 12px;
    cursor: pointer;
  }

  .file-btn:hover {
    border-color: rgba(99, 102, 241, 0.5);
  }

  .file-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .file-name {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.62);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .file-input {
    display: none;
  }

  .file-error {
    font-size: 11px;
    color: rgba(239, 68, 68, 0.9);
    line-height: 1.35;
    word-break: break-word;
  }

  .client-empty {
    padding: 10px 8px;
    color: rgba(255, 255, 255, 0.6);
    font-size: 12px;
  }

  .client-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 160px;
    overflow: auto;
    padding-right: 2px;
  }

  .client-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 10px;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(2, 6, 23, 0.35);
    color: rgba(255, 255, 255, 0.88);
    cursor: pointer;
    text-align: left;
  }

  .client-item:hover {
    border-color: rgba(99, 102, 241, 0.35);
    background: rgba(2, 6, 23, 0.45);
  }

  .client-item.selected {
    border-color: rgba(99, 102, 241, 0.7);
    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
  }

  .client-item.in-range {
    border-color: rgba(99, 102, 241, 0.35);
  }

  .client-dot {
    width: 10px;
    height: 10px;
    border-radius: 999px;
    background: rgba(250, 204, 21, 0.95);
    box-shadow: 0 0 0 2px rgba(250, 204, 21, 0.18);
    flex: 0 0 auto;
  }

  .client-dot.ready {
    background: rgba(34, 197, 94, 0.9);
    box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.16);
  }

  .client-dot.error {
    background: rgba(239, 68, 68, 0.92);
    box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.18);
  }

  .client-main {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 10px;
    width: 100%;
    min-width: 0;
  }

  .client-id {
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .client-time {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.6);
    flex: 0 0 auto;
  }

  .control-unknown {
    padding: 10px 12px;
    color: rgba(255, 255, 255, 0.65);
    font-size: 12px;
  }

  .sensor-inline-value {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 600;
    color: rgba(99, 102, 241, 0.95);
    text-align: right;
    min-width: 56px;
    white-space: nowrap;
  }

  .midi-learn {
    padding: 6px 10px 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .midi-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .midi-binding {
    flex: 1;
    min-width: 0;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.76);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(2, 6, 23, 0.32);
    border-radius: 10px;
    padding: 6px 10px;
  }

  .midi-btn {
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: rgba(2, 6, 23, 0.38);
    color: rgba(255, 255, 255, 0.9);
    border-radius: 10px;
    padding: 6px 10px;
    font-size: 12px;
    cursor: pointer;
    flex: 0 0 auto;
  }

  .midi-btn:hover {
    border-color: rgba(99, 102, 241, 0.45);
    background: rgba(2, 6, 23, 0.5);
  }

  .midi-btn.active {
    border-color: rgba(99, 102, 241, 0.75);
    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
  }

  .midi-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .midi-hint {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.62);
  }

  .midi-last {
    font-family: var(--font-mono);
    font-size: 11px;
    color: rgba(20, 184, 166, 0.92);
  }

  .midi-clear {
    align-self: flex-start;
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: rgba(2, 6, 23, 0.35);
    color: rgba(255, 255, 255, 0.84);
    border-radius: 10px;
    padding: 6px 10px;
    font-size: 12px;
    cursor: pointer;
  }

  .midi-clear:hover {
    border-color: rgba(239, 68, 68, 0.45);
    background: rgba(2, 6, 23, 0.5);
  }
</style>
