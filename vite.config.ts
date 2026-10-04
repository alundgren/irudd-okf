import { defineConfig } from 'vite-plus';
export default defineConfig({
  build: { outDir: 'web-dist', assetsInlineLimit: 100_000_000 },
  test: { include: ['packages/**/test/**/*.test.ts', 'benchmarks/test/**/*.test.ts'], testTimeout: 30_000 },
  pack: {
    entry: ['packages/cli/src/main.ts'],
    deps: { alwaysBundle: [/.*/] },
    exe: {
      fileName: 'irudd-okf',
      seaConfig: { assets: { 'viewer.html': 'web-dist/viewer.html' }, useCodeCache: false, useSnapshot: false },
    },
  },
});
