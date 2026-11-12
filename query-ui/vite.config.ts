import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  // the generated finders import the library through these aliases; the library is one folder up
  server: {
    fs: { allow: ['..'] },
    // the Databricks proxy (npm run proxy); a page cannot call a workspace itself
    proxy: { '/api/2.0/sql': 'http://localhost:8787' },
  },
  build: { target: 'es2022' },
});
