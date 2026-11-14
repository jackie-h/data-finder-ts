// The library build: src/index.ts as dist/index.js (+ dist/styles.css). What the page is built on stays the consumer's to install
// (peer dependencies), so it is one copy of React, of AG Grid, of DuckDB-wasm and of data-finder-ts in their app.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  publicDir: false,
  build: {
    outDir: 'dist/lib',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
    cssCodeSplit: false,
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: () => 'index.js', cssFileName: 'styles' },
    rolldownOptions: {
      external: [/^react($|\/)/, /^react-dom($|\/)/, /^ag-grid-/, /^@duckdb\/duckdb-wasm/, /^data-finder-ts($|\/)/],
    },
  },
});
