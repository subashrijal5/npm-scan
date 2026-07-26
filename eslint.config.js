import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import security from 'eslint-plugin-security';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'bun.lock'],
  },
  js.configs.recommended,
  security.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // The tool intentionally builds shell commands / paths from CLI and
      // remote (package registry, git) input; these are handled deliberately
      // rather than accidentally, so keep the security plugin advisory here.
      'security/detect-object-injection': 'off',
      'security/detect-non-literal-fs-filename': 'warn',
      'security/detect-child-process': 'warn',
    },
  },
  {
    // Type-aware linting only applies to TS files that are part of the
    // tsconfig project (src/ and tests/). bin/npm-scan.js is a plain JS
    // entry script outside that project, so it's excluded below.
    files: ['**/*.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Codebase convention: a leading underscore marks an intentionally
      // unused parameter/variable (e.g. unused args in mock functions).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  prettierConfig,
);
