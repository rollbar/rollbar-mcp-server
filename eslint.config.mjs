// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import pluginPrettier from 'eslint-plugin-prettier';

export default tseslint.config(
  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,   // +type‑aware rules
  prettier,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,                // ask TS for types
        tsconfigRootDir: import.meta.dirname // path to your tsconfig
      }
    }
  },
  {
    plugins: { prettier: pluginPrettier },
    rules: {
      'prettier/prettier': 'error',
      '@typescript-eslint/no-explicit-any': 'off',
    }
  },
);

