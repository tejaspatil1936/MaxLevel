// Shared flat config. Usage: export default [...base, ...react] in a package's eslint.config.js.
import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import prettier from 'eslint-config-prettier';
import reactPlugin from 'eslint-plugin-react';
import hooksPlugin from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export const ignores = {
  ignores: [
    'legacy/**',
    '**/node_modules/**',
    '**/dist/**',
    '**/out/**',
    '**/.next/**',
    '**/storybook-static/**',
    '**/coverage/**',
    '**/playwright-report/**',
    '**/test-results/**',
    '.verify/**',
    '**/next-env.d.ts',
  ],
};

// Domain code reads time from the injected Clock (CLAUDE.md).
const noDirectTime = {
  'no-restricted-properties': [
    'error',
    { object: 'Date', property: 'now', message: 'Use the injected Clock (clock.now()).' },
  ],
};

export const base = [
  ignores,
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      ...noDirectTime,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    files: [
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.spec.ts',
      'tests/**',
      'scripts/**',
      '**/test-support/**',
      '**/clock.ts',
    ],
    rules: { 'no-restricted-properties': 'off' },
  },
  prettier,
];

// React and Next.js for apps/web and packages/ui. All copy goes through t() (A11Y-23).
export const react = [
  {
    files: ['**/*.tsx'],
    plugins: { react: reactPlugin, 'react-hooks': hooksPlugin, '@next/next': nextPlugin },
    languageOptions: { globals: { ...globals.browser } },
    settings: { react: { version: '19' } },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactPlugin.configs['jsx-runtime'].rules,
      ...hooksPlugin.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      'react/prop-types': 'off',
      'react/jsx-no-literals': [
        'error',
        { noStrings: false, ignoreProps: true, allowedStrings: ['·', '/', ':', '(', ')', '—', '×'] },
      ],
    },
  },
  {
    files: ['**/*.stories.tsx', '**/*.test.tsx'],
    rules: { 'react/jsx-no-literals': 'off' },
  },
];

export default base;
