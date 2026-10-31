import { configDefaults, defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    // er-diagram has its own tests (node:test, `npm test --prefix er-diagram`)
    exclude: [...configDefaults.exclude, 'er-diagram/**'],
  },
});
