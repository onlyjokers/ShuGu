/**
 * Purpose: Shared UI-only state for the node graph (groups, custom nodes, etc).
 *
 * This module is intentionally small and framework-agnostic so `projectManager`
 * can persist/restore it without importing NodeCanvas runtime code.
 */
import { writable, type Writable } from 'svelte/store';
import type { NodeGroup } from '$lib/components/nodes/node-canvas/controllers/group-controller';

export const nodeGroupsState: Writable<NodeGroup[]> = writable([]);

