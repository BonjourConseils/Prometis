import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      '**/dist/**',
      '**/.next/**',
      'coverage/**',
      'prisma/migrations/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      // Les montants et ids viennent de Prisma : on veut un typage explicite aux frontières.
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // `any` est un trou dans l'isolation tenant dès qu'il touche une requête.
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Le seed et les tests parlent à l'opérateur : console.log y est légitime.
    files: ['prisma/seed.ts', 'scripts/**/*.ts', 'tests/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    // Fichiers de configuration exécutés par Node : `process` y est global.
    files: ['**/*.config.mjs', '**/*.config.mts'],
    languageOptions: { globals: { process: 'readonly' } },
  },
);
