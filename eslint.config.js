import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'node_modules/'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  prettier,
  {
    // The core must stay framework- and runtime-agnostic so the web page and
    // editor plugin can reuse it. Node APIs belong in src/cli only.
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['node:*'], message: 'src/core must not import Node built-ins.' },
            { group: ['**/cli/*'], message: 'src/core must not depend on src/cli.' },
          ],
        },
      ],
    },
  },
);
