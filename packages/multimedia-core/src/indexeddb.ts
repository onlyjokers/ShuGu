/**
 * Purpose: Tiny IndexedDB helper for persisting asset verification metadata.
 *
 * - Keeps data small and deterministic (no blobs).
 * - Gracefully falls back to in-memory storage when IndexedDB is unavailable.
 */

export type AssetMetaRecord = {
  assetId: string;
  sha256?: string | null;
  etag: string | null;
  sizeBytes: number | null;
  verifiedAt: number;
};

type IndexedDbLike = IDBFactory;

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined' && Boolean(indexedDB);
}

export class AssetMetaStore {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private memory = new Map<string, AssetMetaRecord>();

  constructor(
    private readonly dbName = 'shugu-multimedia-core-v1',
    private readonly storeName = 'asset-meta'
  ) { }

  async get(assetId: string): Promise<AssetMetaRecord | null> {
    const id = assetId.trim();
    if (!id) return null;

    if (!hasIndexedDb()) return this.memory.get(id) ?? null;

    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const req = store.get(id);
      req.onsuccess = () => resolve((req.result as AssetMetaRecord) ?? null);
      req.onerror = () => reject(req.error ?? new Error('indexeddb get failed'));
    });
  }

  async put(record: AssetMetaRecord): Promise<void> {
    const id = record.assetId.trim();
    if (!id) return;

    const normalized: AssetMetaRecord = { ...record, assetId: id };

    if (!hasIndexedDb()) {
      this.memory.set(id, normalized);
      return;
    }

    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('indexeddb put failed'));
      const store = tx.objectStore(this.storeName);
      store.put(normalized);
    });
  }

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const factory = indexedDB as unknown as IndexedDbLike;
      const req = factory.open(this.dbName, 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'assetId' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('indexeddb open failed'));
    });
    return this.dbPromise;
  }
}
