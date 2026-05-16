import typescriptEslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import stylistic from '@stylistic/eslint-plugin';

export default [
  {
    ignores: [
      '**/*.js',
      '**/*.d.ts',
      'node_modules/',
      'packages/*/dist/',
      '**/playwright-report/',
    ],
  },
  {
    files: ['packages/*/src/**/*.ts'],
    plugins: {
      '@typescript-eslint': typescriptEslint,
      '@stylistic': stylistic,
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      // correctness
      '@typescript-eslint/no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      '@typescript-eslint/no-floating-promises': 'error',
      'no-var': 'error',
      'eqeqeq': ['error', 'always', { null: 'ignore' }],

      // style
      '@stylistic/quotes': ['error', 'single'],
      '@stylistic/semi': ['error', 'always'],
      '@stylistic/object-curly-spacing': ['error', 'always'],
      '@stylistic/indent': ['error', 2],
      '@stylistic/comma-dangle': ['error', 'always-multiline'],
    },
  },
];
