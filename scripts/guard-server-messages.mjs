/**
 * Purpose: Guard against ad-hoc server emits of control messages (must use protocol helpers).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const targetRoot = path.join(repoRoot, 'apps', 'server', 'src');

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.svelte-kit',
  '.turbo',
  'dist',
  'dist-out',
  'dist-node-core',
  'build',
  'coverage',
  'out',
]);

const SOURCE_EXTS = new Set(['.ts', '.js', '.mjs', '.cjs']);
const EMIT_RE = /emit\s*\(\s*['"]msg['"]\s*,/g;
const CONTROL_RE = /type\s*:\s*['"]control['"]/;

function shouldSkipDir(name) {
  if (IGNORED_DIRS.has(name)) return true;
  if (name.startsWith('dist')) return true;
  if (name.startsWith('.')) return true;
  return false;
}

function collectFiles(rootDir) {
  const files = [];
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (shouldSkipDir(entry.name)) continue;
      files.push(...collectFiles(fullPath));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (SOURCE_EXTS.has(ext)) files.push(fullPath);
    }
  }
  return files;
}

function getLineAndColumn(content, index) {
  let line = 1;
  let column = 1;
  for (let i = 0; i < index; i += 1) {
    if (content[i] === '\n') {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

function run() {
  if (!fs.existsSync(targetRoot)) {
    console.log('[server-msg-guard] apps/server/src not found, skipping');
    return;
  }

  const files = collectFiles(targetRoot);
  const errors = [];

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8');
    let match;
    while ((match = EMIT_RE.exec(content))) {
      const window = content.slice(match.index, match.index + 240);
      if (CONTROL_RE.test(window)) {
        const { line, column } = getLineAndColumn(content, match.index);
        errors.push({
          filePath,
          line,
          column,
          message: 'Ad-hoc emit("msg", { type: "control" ... }) is not allowed.',
        });
      }
    }
  }

  if (errors.length > 0) {
    console.error('\n[server-msg-guard] violations found:');
    for (const error of errors) {
      const relativePath = path.relative(repoRoot, error.filePath);
      console.error(`- ${relativePath}:${error.line}:${error.column} ${error.message}`);
    }
    console.error(`\n[server-msg-guard] total: ${errors.length} issue(s)`);
    process.exitCode = 1;
    return;
  }

  console.log(`[server-msg-guard] ok (${files.length} files scanned)`);
}

run();
