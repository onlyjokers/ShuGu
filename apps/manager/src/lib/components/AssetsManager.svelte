<!-- Purpose: Assets Manager page for browsing/uploading/deleting assets stored in the Asset Service. -->
<script lang="ts">
  import { onMount } from 'svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import { assetsStore, type AssetRecord, type AssetKind } from '$lib/stores/assets';
  import { migrateCurrentGraphDataUrls, type MigrateProgress } from '$lib/assets/migrate-dataurls';
  import { saveLocalProject } from '$lib/project/projectManager';

  export let serverUrl: string;

  let assets: AssetRecord[] = [];
  let status: 'idle' | 'loading' | 'error' = 'idle';
  let errorMessage: string | null = null;

  let filterKind: 'all' | AssetKind = 'all';
  let query = '';

  let uploadInput: HTMLInputElement | null = null;
  let uploading = false;
  let uploadError = '';

  let migrating = false;
  let migrateLog: string[] = [];
  let migrateError: string | null = null;

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

  function appendMigrateLog(line: string): void {
    migrateLog = [...migrateLog.slice(-80), line];
  }

  function onMigrateProgress(p: MigrateProgress): void {
    if (p.kind === 'scan') appendMigrateLog(`[scan] found=${p.totalFound}`);
    if (p.kind === 'upload')
      appendMigrateLog(`[upload] ${p.index}/${p.total} mime=${p.mimeType} ~${Math.round(p.bytesApprox / 1024)}KB`);
    if (p.kind === 'replace') appendMigrateLog(`[replace] replaced=${p.replaced}`);
    if (p.kind === 'done')
      appendMigrateLog(`[done] replaced=${p.replaced} uploaded=${p.uploaded} skipped=${p.skipped}`);
    if (p.kind === 'error') appendMigrateLog(`[error] ${p.message}`);
  }

  async function migrateDataUrlsInCurrentGraph(): Promise<void> {
    if (migrating) return;
    migrating = true;
    migrateError = null;
    migrateLog = [];

    try {
      const token = getWriteToken();
      if (!token) throw new Error('Missing Asset Write Token (set it on the connect screen).');

      const result = await migrateCurrentGraphDataUrls({
        serverUrl,
        writeToken: token,
        onProgress: onMigrateProgress,
      });

      saveLocalProject('dataurl-migration');
      appendMigrateLog(`[save] local project updated (${result.replaced} refs)`);
      await assetsStore.refresh();
    } catch (err) {
      migrateError = err instanceof Error ? err.message : String(err);
    } finally {
      migrating = false;
    }
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
      <Button variant="secondary" size="sm" on:click={migrateDataUrlsInCurrentGraph} disabled={migrating}>
        {migrating ? 'Migrating…' : 'Migrate DataURLs'}
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

  {#if migrateError}
    <div class="banner error">{migrateError}</div>
  {/if}

  {#if migrateLog.length > 0}
    <Card>
      <div class="migrate-log">
        {#each migrateLog as line (line)}
          <div class="mono">{line}</div>
        {/each}
      </div>
    </Card>
  {/if}

  <div class="filters">
    <Card class="filters-card">
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

  <Card class="table-card">
    <div class="table-wrap">
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
            <div class="cell mono" data-label="ID">{a.id}</div>
            <div class="cell name" data-label="Name">
              <div class="name-text">
                <div class="main">{a.originalName}</div>
                <div class="sub">{a.mimeType}</div>
              </div>
            </div>
              <div class="cell" data-label="Kind">
                <span class="pill {a.kind}">{a.kind}</span>
              </div>
              <div class="cell" data-label="Size">{formatBytes(a.sizeBytes)}</div>
              <div class="cell row-actions" data-label="Actions">
                <div class="actions-list">
                  <button class="link" on:click={() => copy(`asset:${a.id}`)}>Copy ref</button>
                  <button class="link" on:click={() => copy(a.sha256)}>Copy sha</button>
                  <button class="link danger" on:click={() => deleteAsset(a.id)}>Delete</button>
                </div>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </div>
  </Card>
</div>

<style>
  .assets-page {
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    width: 100%;
    max-width: 1200px;
    margin: 0 auto;
  }

  .header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 16px;
    align-items: center;
    padding: 16px 18px;
    border-radius: 16px;
    border: 1px solid var(--border-color);
    background: linear-gradient(135deg, rgba(99, 102, 241, 0.12), rgba(15, 23, 42, 0.72));
    box-shadow: 0 18px 40px rgba(15, 23, 42, 0.35);
  }

  .h1 {
    font-size: var(--text-xl, 1.4rem);
    font-weight: 700;
    letter-spacing: 0.2px;
  }

  .hint {
    margin-top: 4px;
    font-size: var(--text-xs, 0.8rem);
    color: var(--text-muted);
    font-family: var(--font-mono);
    overflow-wrap: anywhere;
  }

  .actions {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
    justify-content: flex-end;
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
    display: grid;
    grid-template-columns: minmax(160px, 220px) minmax(0, 1fr) auto;
    gap: 12px;
    align-items: end;
  }

  .filter {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: var(--text-sm, 0.85rem);
    color: var(--text-secondary);
    min-width: 0;
  }

  .filter select,
  .filter .search {
    border-radius: 10px;
    padding: 8px 12px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    color: var(--text-primary);
    outline: none;
    font-size: var(--text-sm, 0.85rem);
  }

  .filter.grow {
    flex: 1;
  }

  .count {
    align-self: center;
    padding: 6px 12px;
    border-radius: 999px;
    border: 1px solid var(--border-color);
    background: rgba(15, 23, 42, 0.6);
    font-size: var(--text-xs, 0.8rem);
    color: var(--text-secondary);
  }

  .table-wrap {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  .table {
    display: flex;
    flex-direction: column;
    min-width: 760px;
  }

  .migrate-log {
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 200px;
    overflow: auto;
  }

  .row {
    display: grid;
    grid-template-columns: minmax(180px, 1.2fr) minmax(220px, 1.6fr) 110px 120px minmax(240px, 1fr);
    gap: 12px;
    padding: 10px 12px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    align-items: center;
    transition: background 160ms ease;
  }

  .row > div {
    min-width: 0;
  }

  .row:not(.head):hover {
    background: rgba(99, 102, 241, 0.08);
  }

  .row.head {
    border-top: none;
    padding-top: 6px;
    padding-bottom: 12px;
    color: var(--text-secondary);
    font-size: var(--text-xs, 0.75rem);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .mono {
    font-family: var(--font-mono);
    font-size: var(--text-sm, 0.85rem);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name .main {
    font-size: var(--text-sm, 0.85rem);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name .sub {
    margin-top: 2px;
    font-size: var(--text-xs, 0.75rem);
    color: var(--text-muted);
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
    border: 1px solid var(--border-color);
    background: rgba(15, 23, 42, 0.6);
    font-size: var(--text-xs, 0.7rem);
    text-transform: uppercase;
    letter-spacing: 0.25px;
    color: var(--text-secondary);
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
    justify-content: flex-end;
  }

  .actions-list {
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
    color: var(--text-secondary);
    font-size: var(--text-sm, 0.85rem);
    text-align: center;
  }

  /* Responsive layout for narrow viewports. */
  @media (max-width: 960px) {
    .header {
      grid-template-columns: 1fr;
      align-items: start;
    }

    .actions {
      justify-content: flex-start;
    }

    .filters-row {
      grid-template-columns: 1fr;
      justify-items: start;
    }

    .count {
      align-self: start;
    }

    .table {
      min-width: 680px;
    }
  }

  @media (max-width: 720px) {
    .assets-page {
      padding: 14px;
    }

    .table-wrap {
      overflow: visible;
    }

    .table {
      min-width: 0;
    }

    .row {
      grid-template-columns: 1fr;
      gap: 10px;
      padding: 12px 14px;
    }

    .row.head {
      display: none;
    }

    .row .cell {
      display: grid;
      grid-template-columns: minmax(84px, 110px) minmax(0, 1fr);
      gap: 10px;
      align-items: start;
    }

    .row .cell::before {
      content: attr(data-label);
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: var(--text-muted);
    }

    .mono,
    .name .main,
    .name .sub {
      white-space: normal;
      overflow: visible;
      text-overflow: initial;
      word-break: break-word;
    }

    .row-actions {
      display: grid;
      grid-template-columns: minmax(84px, 110px) minmax(0, 1fr);
      gap: 10px;
      justify-content: start;
    }

    .actions-list {
      justify-content: flex-start;
    }
  }
</style>
