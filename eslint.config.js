import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

// Focused lint baseline: catches real correctness bugs (undeclared names,
// unsafe declarations, accidental reassignment) without imposing stylistic
// churn on the existing codebase. Prettier handles formatting separately, so
// eslint-config-prettier disables any conflicting layout rules.
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'test-results/**',
      'qa-artifacts/**',
      'artifacts/**',
      '.artifacts/**',
      '.local/**',
      '.omc/**',
      '.omx/**',
      'agent-context/**',
      'docs/**',
      'Spec/**'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node
      }
    },
    rules: {
      // Unused vars are worth surfacing, but allow intentional _-prefixed and
      // caught-error placeholders so the gate stays at zero without code churn.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
          ignoreRestSiblings: true
        }
      ],
      // The codebase intentionally uses some empty catch blocks (best-effort
      // localStorage, aborts); the comment documents intent.
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  },
  {
    // Tests use the node:test runner and assert; keep the same globals.
    files: ['tests/**/*.{js,ts}'],
    languageOptions: {
      globals: { ...globals.node }
    },
    rules: {
      // Playwright fixtures REQUIRE an object-destructuring first arg, so an
      // empty `{}` pattern (e.g. `async ({}, testInfo) => {}`) is intentional.
      'no-empty-pattern': 'off'
    }
  }
);
