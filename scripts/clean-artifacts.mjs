/**
 * Purpose: Remove local build artifacts/caches without touching source files or node_modules.
 *
 * This intentionally focuses on directories that are safe to delete and frequently created by:
 * - SvelteKit/Vite (`.svelte-kit*`, `build*`, `vite-cache*`, `.vite-cache*`)
 * - TypeScript/Nest (`dist*`)
 * - Tooling (`coverage`, `out`, `.turbo`)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const SCAN_ROOT_DIRS = ['apps', 'packages'];
const TOP_LEVEL_DIRS = ['.turbo', 'coverage', 'out'];

const EXTRA_FILE_PREFIXES = ['vite.config.ts.timestamp-'];

function isDirectory(fullPath) {
  try {
    return fs.statSync(fullPath).isDirectory();
  } catch {
    return false;
  }
}

function removePathIfExists(fullPath) {
  if (!fs.existsSync(fullPath)) return { deleted: false };
  try {
    fs.rmSync(fullPath, { recursive: true, force: true });
    return { deleted: true };
  } catch (error) {
    return { deleted: false, error };
  }
}

function shouldDeleteDirName(name) {
  if (!name) return false;
  if (name === 'node_modules') return false;

  if (name === '.turbo' || name === 'coverage' || name === 'out') return true;
  if (name.startsWith('.svelte-kit')) return true;
  if (name.startsWith('.vite-cache')) return true;
  if (name.startsWith('vite-cache')) return true;
  if (name === 'build' || name.startsWith('build-')) return true;
  if (name === 'dist' || name.startsWith('dist-') || name.startsWith('dist_') || name === 'dist-out') return true;

  return false;
}

function cleanTopLevel() {
  const deleted = [];
  const failed = [];
  for (const dir of TOP_LEVEL_DIRS) {
    const fullPath = path.join(repoRoot, dir);
    const result = removePathIfExists(fullPath);
    if (result.deleted) deleted.push(dir);
    else if (result.error) failed.push({ path: dir, error: result.error });
  }
  return { deleted, failed };
}

function cleanWorkspaceDirs() {
  const deleted = [];
  const failed = [];

  for (const root of SCAN_ROOT_DIRS) {
    const rootDir = path.join(repoRoot, root);
    if (!isDirectory(rootDir)) continue;

    const owners = fs.readdirSync(rootDir, { withFileTypes: true }).filter((e) => e.isDirectory());
    for (const owner of owners) {
      const ownerDir = path.join(rootDir, owner.name);
      const entries = fs.readdirSync(ownerDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (!shouldDeleteDirName(entry.name)) continue;
        const rel = path.relative(repoRoot, path.join(ownerDir, entry.name));
        const result = removePathIfExists(path.join(ownerDir, entry.name));
        if (result.deleted) deleted.push(rel);
        else if (result.error) failed.push({ path: rel, error: result.error });
      }

      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const matchesPrefix = EXTRA_FILE_PREFIXES.some((prefix) => entry.name.startsWith(prefix));
        if (!matchesPrefix) continue;
        const rel = path.relative(repoRoot, path.join(ownerDir, entry.name));
        const result = removePathIfExists(path.join(ownerDir, entry.name));
        if (result.deleted) deleted.push(rel);
        else if (result.error) failed.push({ path: rel, error: result.error });
      }
    }
  }

  return { deleted, failed };
}

function main() {
  const top = cleanTopLevel();
  const ws = cleanWorkspaceDirs();

  const deleted = [...top.deleted, ...ws.deleted];
  const failed = [...top.failed, ...ws.failed];

  if (deleted.length === 0) {
    console.log('[clean:artifacts] nothing to delete');
  } else {
    console.log(`[clean:artifacts] deleted ${deleted.length} path(s):`);
    for (const item of deleted) console.log(`- ${item}`);
  }

  if (failed.length > 0) {
    const permissionDenied = failed.filter((item) => item.error?.code === 'EACCES' || item.error?.code === 'EPERM');
    const otherFailures = failed.filter((item) => !permissionDenied.includes(item));

    if (permissionDenied.length > 0) {
      console.warn(
        `\n[clean:artifacts] skipped ${permissionDenied.length} path(s) due to permissions (likely created via sudo):`,
      );
      for (const item of permissionDenied) console.warn(`- ${item.path} (${item.error.code})`);
      console.warn('\nFix (one-time):');
      console.warn('- Ensure build artifacts are owned by your user (avoid running pnpm/vite/nest via sudo).');
      console.warn(`- Example: sudo chown -R $(whoami) <path> (then rerun pnpm clean:artifacts)`);
    }

    if (otherFailures.length > 0) {
      console.warn(`\n[clean:artifacts] failed to delete ${otherFailures.length} path(s):`);
      for (const item of otherFailures) console.warn(`- ${item.path} (${item.error?.code ?? 'unknown'})`);
      process.exitCode = 1;
    }
  }
}

main();
