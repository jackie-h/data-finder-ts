import { configDefaults, defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

// The specs that run against Spark (tests/spark/) need a Spark Connect server, which `npm run test:spark` starts
const spark = process.env.SPARK_SPECS !== undefined;

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    // er-diagram has its own tests (node:test, `npm test --prefix er-diagram`)
    exclude: [...configDefaults.exclude, 'er-diagram/**', ...(spark ? [] : ['tests/spark/**'])],
    // the first query of a Spark session starts its work: it takes a while
    ...(spark ? { testTimeout: 120_000, hookTimeout: 180_000, fileParallelism: false } : {}),
  },
});
