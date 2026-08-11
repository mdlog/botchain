import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'contracts/**',
      'cli/**',
      'compute-agent-rs/**',
      'public/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  // Type-aware rules need a tsconfig program. This config file itself is plain
  // JS and outside the TS project, so the typed rules are turned off for .js.
  {
    files: ['**/*.js'],
    languageOptions: { globals: globals.node },
    ...tseslint.configs.disableTypeChecked,
  },

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      /* React Compiler readiness rules. The remaining hits are guard clauses
         that reset derived state when the selected job or route changes, and
         effects that load chain data and set it in the async continuation.
         Expressing those the Compiler's way means adopting a data-fetching
         library; until that happens these are signal to act on, not a gate. */
      'react-hooks/set-state-in-effect': 'warn',

      /* `any` is the escape hatch this codebase leaned on to avoid typing the
         contract layer. Typed ABIs removed the need for it, so new ones should
         be argued for rather than reached for — warn, not error, so lint stays
         usable while the last few are worked out. */
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',

      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],

      /* Every await in this app is an RPC call; a floating one is a lost error. */
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true, allowNullish: true, allowAny: true },
      ],

      /* console.log is debug residue; warn and error are how this app reports
         failures it cannot show in the UI. */
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  /* Node-side files: the Vite config and the AI proxy run in Node, not the browser. */
  {
    files: ['vite.config.ts', 'vite-ai-proxy.ts'],
    languageOptions: { globals: globals.node },
    rules: { 'no-console': 'off' },
  },

  {
    files: ['**/*.test.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },

  prettier,
);
