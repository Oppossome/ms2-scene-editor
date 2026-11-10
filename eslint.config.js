import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['node_modules/', '.svelte-kit/', 'build/', '.data/', 'extracted/', 'vendor/']),
  js.configs.recommended,
  {
    files: ['**/*.{ts,svelte}'],
    extends: [ts.configs.recommended]
  },
  {
    files: ['**/*.svelte', '**/*.svelte.{js,ts}'],
    extends: [svelte.configs['flat/recommended'], svelte.configs['flat/prettier']],
    languageOptions: { parserOptions: { parser: ts.parser } }
  },
  {
    files: ['src/**/*.{js,ts,svelte}'],
    languageOptions: { globals: globals.browser }
  },
  {
    files: ['*.{js,ts}', 'scripts/**/*.{js,ts}', 'src/lib/server/**/*.ts', 'src/routes/**/+server.ts', 'cmd/**/*.js'],
    languageOptions: { globals: globals.node }
  },
  {
    files: ['cmd/**/*.js'],
    languageOptions: { sourceType: 'commonjs' },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_' }] }
  },
  {
    files: ['**/*.svelte', '**/*.svelte.{js,ts}'],
    rules: {
      // Runtime caches and temporary collections are driven by explicit revisions, not collection reactivity.
      'svelte/prefer-svelte-reactivity': 'off'
    }
  },
  {
    files: ['**/*.{ts,svelte}'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }
      ]
    }
  },
  prettier
);
