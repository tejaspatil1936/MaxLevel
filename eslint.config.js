import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['legacy/**', '**/node_modules/**', '**/dist/**', '**/out/**', '**/.next/**', '.verify/**'] },
  js.configs.recommended,
  { languageOptions: { globals: { ...globals.node } } },
];
