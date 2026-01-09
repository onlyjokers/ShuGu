/**
 * Client identity helper (device/session IDs persisted in storage).
 */

import type { ClientIdentity } from '@shugu/sdk-client';

const DEVICE_ID_STORAGE_KEY = 'shugu-device-id';
const INSTANCE_ID_STORAGE_KEY = 'shugu-client-instance-id';
const CLIENT_ID_STORAGE_KEY = 'shugu-client-id';

function createRandomId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  }
  return `${prefix}${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function getOrCreateStorageId(storage: Storage, key: string, prefix: string): string {
  const existing = storage.getItem(key);
  if (existing && existing.trim()) return existing;
  const id = createRandomId(prefix);
  storage.setItem(key, id);
  return id;
}

export function getOrCreateClientIdentity(): ClientIdentity | null {
  if (typeof window === 'undefined') return null;

  const deviceId = getOrCreateStorageId(window.localStorage, DEVICE_ID_STORAGE_KEY, 'c_');
  const instanceId = getOrCreateStorageId(window.sessionStorage, INSTANCE_ID_STORAGE_KEY, 'i_');

  const storedClientId = window.sessionStorage.getItem(CLIENT_ID_STORAGE_KEY);
  const clientId = storedClientId && storedClientId.trim() ? storedClientId : deviceId;
  window.sessionStorage.setItem(CLIENT_ID_STORAGE_KEY, clientId);

  return { deviceId, instanceId, clientId };
}

export function persistAssignedClientId(assignedClientId: string): void {
  if (typeof window === 'undefined') return;
  if (!assignedClientId) return;
  const current = window.sessionStorage.getItem(CLIENT_ID_STORAGE_KEY);
  if (current === assignedClientId) return;
  window.sessionStorage.setItem(CLIENT_ID_STORAGE_KEY, assignedClientId);
}

