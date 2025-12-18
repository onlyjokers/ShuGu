import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import svelteParser from 'svelte-eslint-parser';
import globals from 'globals';

const tsRules = {
  ...tsPlugin.configs.recommended.rules,
  '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
  '@typescript-eslint/no-explicit-any': 'warn',
  'no-undef': 'off',
  'no-inner-declarations': 'off',
  'no-console': 'off',
};

const svelteRules = {
  ...tsRules,
  // Allow local `@ts-nocheck` in a few complex Svelte integration files (rete types).
  '@typescript-eslint/ban-ts-comment': 'off',
};

const mergedGlobals = (() => {
  const combined = { ...globals.browser, ...globals.node };
  return Object.fromEntries(Object.entries(combined).map(([key, value]) => [key.trim(), value]));
})();

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/.pnpm-store/**',
      '**/dist/**',
      '**/dist-dev/**',
      '**/dist-local/**',
      '**/dist-user/**',
      '**/.svelte-kit/**',
      '**/build/**',
      '**/coverage/**',
      '**/.vite-cache*/**',
      '**/vite-cache-*/**',
      '**/tmp_owner_test/**',
      '**/testdir123/**',
    ],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...mergedGlobals,
      },
    },
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: tsRules,
  },
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parser: svelteParser,
      parserOptions: {
        parser: tsParser,
        extraFileExtensions: ['.svelte'],
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: svelteRules,
  },
];
