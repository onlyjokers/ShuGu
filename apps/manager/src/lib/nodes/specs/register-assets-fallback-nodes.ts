/**
 * Purpose: Register manager-side fallback node definitions for asset loading.
 */

import type { NodeRegistry, NodeDefinition } from '@shugu/node-core';

export const registerAssetsFallbackNodes = (nodeRegistry: NodeRegistry): void => {
  if (!nodeRegistry.get('load-audio-from-assets')) {
    nodeRegistry.register({
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
        { id: 'playbackRate', label: 'Rate', type: 'number', defaultValue: 1, min: 0 },
        { id: 'detune', label: 'Detune', type: 'number', defaultValue: 0 },
        {
          id: 'volume',
          label: 'Volume',
          type: 'number',
          defaultValue: 0,
          min: -1,
          max: 100,
          step: 0.01,
        },
      ],
      outputs: [
        { id: 'ref', label: 'Audio Out', type: 'audio', kind: 'sink' },
        { id: 'ended', label: 'Finish', type: 'boolean' },
      ],
      configSchema: [
        {
          key: 'assetId',
          label: 'Audio Asset',
          type: 'asset-picker',
          assetKind: 'audio',
          defaultValue: '',
        },
        { key: 'playbackRate', label: 'Rate', type: 'number', defaultValue: 1, min: 0 },
        { key: 'detune', label: 'Detune', type: 'number', defaultValue: 0 },
        {
          key: 'volume',
          label: 'Volume',
          type: 'number',
          defaultValue: 0,
          min: -1,
          max: 100,
          step: 0.01,
        },
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
        const assetId = typeof config.assetId === 'string' ? String(config.assetId).trim() : '';
        const playRaw = inputs.play;
        const play = typeof playRaw === 'number' ? playRaw >= 0.5 : Boolean(playRaw);
        return { ref: assetId && play ? 1 : 0, ended: false };
      },
    } satisfies NodeDefinition);
  }

  if (!nodeRegistry.get('load-image-from-assets')) {
    nodeRegistry.register({
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
            { value: 'fit-screen', label: 'Fit Screen' },
            { value: 'cover', label: 'Cover' },
            { value: 'fill', label: 'Fill' },
          ],
        },
      ],
      process: (_inputs, config) => {
        const assetId = typeof config.assetId === 'string' ? String(config.assetId).trim() : '';
        const fitRaw =
          typeof config.fit === 'string' ? String(config.fit).trim().toLowerCase() : '';
        const fit =
          fitRaw === 'cover' || fitRaw === 'fill' || fitRaw === 'fit-screen' ? fitRaw : 'contain';
        const fitHash = fit !== 'contain' ? `#fit=${fit}` : '';
        return { ref: assetId ? `asset:${assetId}${fitHash}` : '' };
      },
    } satisfies NodeDefinition);
  }

  if (!nodeRegistry.get('load-video-from-assets')) {
    nodeRegistry.register({
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
        {
          id: 'volume',
          label: 'Volume',
          type: 'number',
          defaultValue: 0,
          min: -1,
          max: 100,
          step: 0.01,
        },
        { id: 'muted', label: 'Mute', type: 'boolean', defaultValue: true },
      ],
      outputs: [
        { id: 'ref', label: 'Video Out', type: 'video', kind: 'sink' },
        { id: 'ended', label: 'Finish', type: 'boolean' },
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
            { value: 'fit-screen', label: 'Fit Screen' },
            { value: 'cover', label: 'Cover' },
            { value: 'fill', label: 'Fill' },
          ],
        },
      ],
      process: (inputs, config) => {
        const assetId = typeof config.assetId === 'string' ? String(config.assetId).trim() : '';
        const fitRaw =
          typeof config.fit === 'string' ? String(config.fit).trim().toLowerCase() : '';
        const fit =
          fitRaw === 'cover' || fitRaw === 'fill' || fitRaw === 'fit-screen' ? fitRaw : 'contain';
        const startSec =
          typeof inputs.startSec === 'number' && Number.isFinite(inputs.startSec)
            ? Number(inputs.startSec)
            : 0;
        const endSec =
          typeof inputs.endSec === 'number' && Number.isFinite(inputs.endSec)
            ? Number(inputs.endSec)
            : -1;
        const cursorSec =
          typeof inputs.cursorSec === 'number' && Number.isFinite(inputs.cursorSec)
            ? Number(inputs.cursorSec)
            : -1;

        const loopRaw = inputs.loop;
        const playRaw = inputs.play;
        const loop = typeof loopRaw === 'number' ? loopRaw >= 0.5 : Boolean(loopRaw);
        const play = typeof playRaw === 'number' ? playRaw >= 0.5 : Boolean(playRaw);
        const reverseRaw = inputs.reverse;
        const reverse = typeof reverseRaw === 'number' ? reverseRaw >= 0.5 : Boolean(reverseRaw);
        const mutedRaw = inputs.muted;
        const muted = typeof mutedRaw === 'number' ? mutedRaw >= 0.5 : Boolean(mutedRaw);
        const volumeRaw = inputs.volume;
        const volumeParam = typeof volumeRaw === 'string' ? Number(volumeRaw) : Number(volumeRaw);
        const volumeValue = Number.isFinite(volumeParam)
          ? Math.max(-1, Math.min(100, volumeParam))
          : 0;
        const volumeGain =
          volumeValue <= -1
            ? 0
            : volumeValue < 0
              ? 1 + volumeValue
              : volumeValue <= 2
                ? 1 + volumeValue / 2
                : volumeValue;
        const volumeRounded = Math.round(volumeGain * 100) / 100;
        const mutedEffective = muted || volumeRounded <= 0;

        const startClamped = Math.max(0, startSec);
        const endClamped = endSec >= 0 ? Math.max(startClamped, endSec) : -1;
        const tValue = endClamped >= 0 ? `${startClamped},${endClamped}` : `${startClamped},`;

        const cursorClamped = cursorSec >= 0 ? Math.max(startClamped, cursorSec) : -1;
        const positionParam =
          cursorClamped >= 0
            ? `&p=${endClamped >= 0 ? Math.min(endClamped, cursorClamped) : cursorClamped}`
            : '';
        const fitParam = fit !== 'contain' ? `&fit=${fit}` : '';

        return {
          ref: assetId
            ? `asset:${assetId}#t=${tValue}&loop=${loop ? 1 : 0}&play=${play ? 1 : 0}&rev=${reverse ? 1 : 0}&vol=${volumeRounded}&muted=${mutedEffective ? 1 : 0}${positionParam}${fitParam}`
            : '',
          ended: false,
        };
      },
    } satisfies NodeDefinition);
  }
};
