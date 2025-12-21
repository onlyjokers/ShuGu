<!-- Purpose: Assets Manager page for browsing/uploading/deleting assets stored in the Asset Service. -->
<script lang="ts">
  import { onMount } from 'svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import { assetsStore, type AssetRecord, type AssetKind } from '$lib/stores/assets';

  export let serverUrl: string;

  let assets: AssetRecord[] = [];
  let status: 'idle' | 'loading' | 'error' = 'idle';
  let errorMessage: string | null = null;

  let filterKind: 'all' | AssetKind = 'all';
  let query = '';

  let uploadInput: HTMLInputElement | null = null;
  let uploading = false;
  let uploadError = '';

  const storageKeyWriteToken = 'shugu-asset-write-token';

  function getWriteToken(): string {
    try {
      return localStorage.getItem(storageKeyWriteToken) ?? '';
    } catch {
      return '';
    }
  }

  function buildUrl(path: string): string {
    const base = serverUrl.endsWith('/') ? serverUrl : `${serverUrl}/`;
    return new URL(path, base).toString();
  }

  async function refresh(): Promise<void> {
    await assetsStore.refresh();
  }

  function formatBytes(bytes: number): string {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'] as const;
    let v = n;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i += 1;
    }
    return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  }

  async function copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback: ignore
    }
  }

  function openUpload(): void {
    uploadError = '';
    uploadInput?.click?.();
  }

  async function onUploadChange(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    uploading = true;
    uploadError = '';
    try {
      const token = getWriteToken();
      if (!token) throw new Error('Missing Asset Write Token (set it on the connect screen).');

      const formData = new FormData();
      formData.set('file', file);
      formData.set('originalName', file.name);

      const res = await fetch(buildUrl('api/assets'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text ? `HTTP ${res.status}: ${text}` : `HTTP ${res.status}`);
      }
      await assetsStore.refresh();
    } catch (err) {
      uploadError = err instanceof Error ? err.message : String(err);
    } finally {
      uploading = false;
    }
  }

  async function deleteAsset(assetId: string): Promise<void> {
    if (!confirm(`Delete asset ${assetId}?`)) return;
    try {
      const token = getWriteToken();
      if (!token) throw new Error('Missing Asset Write Token (set it on the connect screen).');
      const res = await fetch(buildUrl(`api/assets/${assetId}`), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text ? `HTTP ${res.status}: ${text}` : `HTTP ${res.status}`);
      }
      await assetsStore.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  $: filtered = assets.filter((a) => {
    if (filterKind !== 'all' && a.kind !== filterKind) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      a.id.toLowerCase().includes(q) ||
      a.originalName.toLowerCase().includes(q) ||
      a.sha256.toLowerCase().includes(q) ||
      a.mimeType.toLowerCase().includes(q)
    );
  });

  $: ({ status, error: errorMessage, assets } = $assetsStore);

  onMount(() => {
    void assetsStore.refresh();
  });
</script>

<div class="assets-page">
  <div class="header">
    <div class="title">
      <div class="h1">Assets Manager</div>
      <div class="hint">Server: {serverUrl}</div>
    </div>
    <div class="actions">
      <Button variant="secondary" size="sm" on:click={refresh} disabled={status === 'loading'}>
        {status === 'loading' ? 'Refreshing…' : 'Refresh'}
      </Button>
      <Button variant="primary" size="sm" on:click={openUpload} disabled={uploading}>
        {uploading ? 'Uploading…' : 'Upload'}
      </Button>
      <input
        class="upload-input"
        type="file"
        bind:this={uploadInput}
        on:change={onUploadChange}
      />
    </div>
  </div>

  {#if uploadError}
    <div class="banner error">{uploadError}</div>
  {/if}

  {#if status === 'error'}
    <div class="banner error">{errorMessage ?? 'Unknown error'}</div>
  {/if}

  <div class="filters">
    <Card>
      <div class="filters-row">
        <label class="filter">
          <span>Kind</span>
          <select bind:value={filterKind}>
            <option value="all">All</option>
            <option value="audio">Audio</option>
            <option value="image">Image</option>
            <option value="video">Video</option>
          </select>
        </label>
        <label class="filter grow">
          <span>Search</span>
          <input class="search" bind:value={query} placeholder="id / name / sha256 / mime…" />
        </label>
        <div class="count">{filtered.length} assets</div>
      </div>
    </Card>
  </div>

  <Card>
    <div class="table">
      <div class="row head">
        <div>ID</div>
        <div>Name</div>
        <div>Kind</div>
        <div>Size</div>
        <div>Actions</div>
      </div>

      {#if status === 'loading'}
        <div class="empty">Loading…</div>
      {:else if filtered.length === 0}
        <div class="empty">No assets</div>
      {:else}
        {#each filtered as a (a.id)}
          <div class="row">
            <div class="mono">{a.id}</div>
            <div class="name">
              <div class="main">{a.originalName}</div>
              <div class="sub">{a.mimeType}</div>
            </div>
            <div class="pill {a.kind}">{a.kind}</div>
            <div>{formatBytes(a.sizeBytes)}</div>
            <div class="row-actions">
              <button class="link" on:click={() => copy(`asset:${a.id}`)}>Copy ref</button>
              <button class="link" on:click={() => copy(a.sha256)}>Copy sha</button>
              <button class="link danger" on:click={() => deleteAsset(a.id)}>Delete</button>
            </div>
          </div>
        {/each}
      {/if}
    </div>
  </Card>
</div>

<style>
  .assets-page {
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .header {
    display: flex;
    justify-content: space-between;
    gap: 14px;
    align-items: flex-end;
  }

  .h1 {
    font-size: 20px;
    font-weight: 700;
    letter-spacing: 0.2px;
  }

  .hint {
    margin-top: 4px;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.6);
    font-family: var(--font-mono);
  }

  .actions {
    display: flex;
    gap: 10px;
    align-items: center;
  }

  .upload-input {
    display: none;
  }

  .banner {
    padding: 10px 12px;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(2, 6, 23, 0.28);
    font-size: 12px;
  }

  .banner.error {
    border-color: rgba(239, 68, 68, 0.35);
    background: rgba(239, 68, 68, 0.12);
    color: rgba(255, 255, 255, 0.9);
  }

  .filters-row {
    display: flex;
    gap: 12px;
    align-items: flex-end;
  }

  .filter {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.7);
  }

  .filter select,
  .filter .search {
    border-radius: 10px;
    padding: 7px 10px;
    background: rgba(2, 6, 23, 0.45);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.92);
    outline: none;
    font-size: 12px;
  }

  .filter.grow {
    flex: 1;
  }

  .count {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.65);
  }

  .table {
    display: flex;
    flex-direction: column;
  }

  .row {
    display: grid;
    grid-template-columns: minmax(180px, 1.2fr) minmax(200px, 1.6fr) 110px 120px minmax(220px, 1fr);
    gap: 12px;
    padding: 10px 12px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    align-items: center;
  }

  .row.head {
    border-top: none;
    padding-top: 6px;
    padding-bottom: 12px;
    color: rgba(255, 255, 255, 0.72);
    font-size: 12px;
    font-weight: 600;
  }

  .mono {
    font-family: var(--font-mono);
    font-size: 12px;
    color: rgba(255, 255, 255, 0.9);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name .main {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.92);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name .sub {
    margin-top: 2px;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.55);
    font-family: var(--font-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pill {
    display: inline-flex;
    width: fit-content;
    padding: 3px 8px;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(2, 6, 23, 0.22);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.25px;
    color: rgba(255, 255, 255, 0.82);
  }

  .pill.audio {
    border-color: rgba(34, 197, 94, 0.35);
    background: rgba(34, 197, 94, 0.12);
  }

  .pill.image {
    border-color: rgba(59, 130, 246, 0.35);
    background: rgba(59, 130, 246, 0.12);
  }

  .pill.video {
    border-color: rgba(168, 85, 247, 0.35);
    background: rgba(168, 85, 247, 0.12);
  }

  .row-actions {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
    flex-wrap: wrap;
  }

  .link {
    border: none;
    background: transparent;
    padding: 0;
    font-size: 12px;
    color: rgba(99, 102, 241, 0.95);
    cursor: pointer;
  }

  .link:hover {
    text-decoration: underline;
  }

  .link.danger {
    color: rgba(239, 68, 68, 0.92);
  }

  .empty {
    padding: 16px 12px;
    color: rgba(255, 255, 255, 0.65);
    font-size: 12px;
  }
</style>
