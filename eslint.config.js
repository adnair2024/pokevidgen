import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', 'data/cache/**', 'out/**', 'tools/**'] },
  ...tseslint.configs.recommended,
);
