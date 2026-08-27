import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '.playwright-mcp/**',
      'uploads/**',
      'plans/**',
      '.planning/**',
      'previews/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: [
      'server/**/*.{js,ts}',
      'tests/**/*.{js,mjs,ts}',
      'eslint.config.js',
      'vitest.config.ts',
    ],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: [
      'host-dashboard/src/**/*.{js,jsx,ts,tsx}',
      'participant-page/src/**/*.{js,jsx,ts,tsx}',
      'shared/**/*.{js,ts}',
    ],
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react/jsx-uses-react': 'off',
      'react/react-in-jsx-scope': 'off',
    },
  },
  {
    // Legacy codebase baseline: tighten as modules are refactored
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-empty': 'warn',
    },
  },
);
