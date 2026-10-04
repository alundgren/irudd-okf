import { defineConfig } from 'vite-plus';
export default defineConfig({
  build: { outDir: 'web-dist' },
  pack: {
    entry: ['src/cli.ts'],
    deps: { alwaysBundle: [/.*/] },
    exe: {
      fileName: 'okf-feasibility',
      seaConfig: {
        assets: { 'viewer.html': 'web-dist/index.html' },
        useCodeCache: false,
        useSnapshot: false,
      },
    },
  },
});
