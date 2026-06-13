import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'model/relational': 'src/model/relational.ts',
    'model/milestoning': 'src/model/milestoning.ts',
    'datafinder/attribute': 'src/datafinder/attribute.ts',
    'datafinder/typed-attributes': 'src/datafinder/typed-attributes.ts',
    'datafinder/runner': 'src/datafinder/runner.ts',
    'datafinder/finder-registry': 'src/datafinder/finder-registry.ts',
    'datafinder/sql-generator': 'src/datafinder/sql-generator.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: 'dist',
});
