import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/',
      'coverage/',
      '**/node_modules/',
      'packages/core/src/rules/bundled.ts',
      'packages/core/src/fields/generated/schema.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  prettier,
  {
    files: ['packages/*/scripts/**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', URL: 'readonly', fetch: 'readonly', process: 'readonly' },
    },
  },
  {
    // The core must stay framework- and runtime-agnostic so the web page and
    // editor plugin can reuse it. Node APIs belong in packages/cli only.
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['node:*'], message: 'The core must not import Node built-ins.' },
            { group: ['**/cli/*'], message: 'The core must not depend on the CLI.' },
          ],
        },
      ],
    },
  },
);
