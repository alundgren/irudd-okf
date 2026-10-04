import { defineConfig } from 'vite-plus';
export default defineConfig({
  build: { outDir: 'web-dist', assetsInlineLimit: 100_000_000 },
  test: { include: ['packages/**/test/**/*.test.ts', 'benchmarks/test/**/*.test.ts'], testTimeout: 30_000 },
  pack: {
    entry: ['packages/cli/src/main.ts'],
    deps: { alwaysBundle: [/.*/] },
    exe: {
      fileName: 'irudd-okf',
      seaConfig: { assets: { 'licenses.txt': 'THIRD_PARTY_NOTICES.txt', 'viewer.html': 'web-dist/viewer.html', 'skill/SKILL.md': 'skills/okf/SKILL.md', 'skill/references/usage.md': 'skills/okf/references/usage.md' }, useCodeCache: false, useSnapshot: false },
    },
  },
});
