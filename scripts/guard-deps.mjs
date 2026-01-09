/**
 * Purpose: Guard against disallowed cross-layer imports and deep-imports in the monorepo.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const ROOT_DIRS = ['apps', 'packages', 'tests'];
const SOURCE_EXTS = new Set(['.ts', '.js', '.mjs', '.cjs', '.svelte']);

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

const PACKAGE_LAYER_RULES = {
  protocol: {
    allowPackages: new Set(),
  },
  'node-core': {
    allowPackages: new Set(['protocol']),
  },
};

const IMPORT_RE = /\b(?:import|export)\s+(?:type\s+)?(?:[\w*\s{},]+\s+from\s+)?["']([^"']+)["']/g;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
const REQUIRE_RE = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;

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

function parseExportSubpaths(exportsField) {
  const subpaths = new Set();
  if (!exportsField) return subpaths;
  if (typeof exportsField === 'string') {
    subpaths.add('');
    return subpaths;
  }
  if (typeof exportsField === 'object') {
    for (const key of Object.keys(exportsField)) {
      if (key === '.') {
        subpaths.add('');
      } else if (key.startsWith('./')) {
        subpaths.add(key.slice(2));
      }
    }
  }
  return subpaths;
}

function loadPackageExports() {
  const packagesDir = path.join(repoRoot, 'packages');
  const packageDirs = fs.readdirSync(packagesDir, { withFileTypes: true });
  const allowedSubpathsByPackage = new Map();

  for (const entry of packageDirs) {
    if (!entry.isDirectory()) continue;
    const pkgDir = path.join(packagesDir, entry.name);
    const pkgJsonPath = path.join(pkgDir, 'package.json');
    if (!fs.existsSync(pkgJsonPath)) continue;
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    const pkgName = pkgJson?.name;
    if (!pkgName || !pkgName.startsWith('@shugu/')) continue;
    const shortName = pkgName.replace('@shugu/', '');
    const allowed = parseExportSubpaths(pkgJson.exports);
    allowedSubpathsByPackage.set(shortName, allowed);
  }

  return allowedSubpathsByPackage;
}

function getOwnerInfo(filePath) {
  const relative = path.relative(repoRoot, filePath);
  const parts = relative.split(path.sep);
  if (parts[0] === 'apps' && parts.length > 1) {
    return { kind: 'app', name: parts[1] };
  }
  if (parts[0] === 'packages' && parts.length > 1) {
    return { kind: 'package', name: parts[1] };
  }
  if (parts[0] === 'tests') {
    return { kind: 'test', name: 'tests' };
  }
  return { kind: 'other', name: '' };
}

function parseShuguSpecifier(specifier) {
  if (!specifier.startsWith('@shugu/')) return null;
  const withoutScope = specifier.slice('@shugu/'.length);
  const [pkg, ...rest] = withoutScope.split('/');
  const subpath = rest.join('/');
  return { pkg, subpath };
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

function collectSpecifiers(content) {
  const specifiers = [];
  const regexes = [IMPORT_RE, DYNAMIC_IMPORT_RE, REQUIRE_RE];
  for (const regex of regexes) {
    let match;
    while ((match = regex.exec(content))) {
      specifiers.push({ specifier: match[1], index: match.index });
    }
  }
  return specifiers;
}

function isExternalSpecifier(specifier) {
  return (
    specifier.startsWith('http://') ||
    specifier.startsWith('https://') ||
    specifier.startsWith('data:')
  );
}

function run() {
  const allowedSubpathsByPackage = loadPackageExports();
  const targets = ROOT_DIRS.map((dir) => path.join(repoRoot, dir)).filter((dir) => fs.existsSync(dir));
  const files = targets.flatMap((dir) => collectFiles(dir));

  const errors = [];

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8');
    const owner = getOwnerInfo(filePath);
    const specifiers = collectSpecifiers(content);

    for (const { specifier, index } of specifiers) {
      if (!specifier || specifier.startsWith('.') || specifier.startsWith('/')) continue;
      if (isExternalSpecifier(specifier)) continue;

      const shugu = parseShuguSpecifier(specifier);
      if (!shugu) continue;

      const { pkg, subpath } = shugu;
      const allowedSubpaths = allowedSubpathsByPackage.get(pkg);
      const normalizedSubpath = subpath ?? '';

      if (normalizedSubpath && allowedSubpaths && !allowedSubpaths.has(normalizedSubpath)) {
        const { line, column } = getLineAndColumn(content, index);
        errors.push({
          filePath,
          line,
          column,
          message: `Deep import not allowed: ${specifier} (allowed: ${[...allowedSubpaths].join(', ') || '[root only]'})`,
        });
        continue;
      }

      if (owner.kind === 'package') {
        const rules = PACKAGE_LAYER_RULES[owner.name];
        if (rules && pkg !== owner.name && !rules.allowPackages.has(pkg)) {
          const { line, column } = getLineAndColumn(content, index);
          errors.push({
            filePath,
            line,
            column,
            message: `Disallowed package dependency: ${owner.name} -> ${pkg}`,
          });
        }
      }
    }
  }

  if (errors.length > 0) {
    console.error('\n[deps-guard] violations found:');
    for (const error of errors) {
      const relativePath = path.relative(repoRoot, error.filePath);
      console.error(`- ${relativePath}:${error.line}:${error.column} ${error.message}`);
    }
    console.error(`\n[deps-guard] total: ${errors.length} issue(s)`);
    process.exitCode = 1;
    return;
  }

  console.log(`[deps-guard] ok (${files.length} files scanned)`);
}

run();
