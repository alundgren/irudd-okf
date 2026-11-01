import { defineConfig } from 'vite-plus';
import { skillAssets } from './packages/cli/src/skill-files.ts';
export default defineConfig({
  test: { include: ['packages/**/test/**/*.test.ts'], testTimeout: 30_000 },
  pack: {
    entry: ['packages/cli/src/main.ts'],
    deps: { alwaysBundle: [/.*/] },
    exe: {
      fileName: 'irudd-okf',
      seaConfig: { assets: { 'licenses.txt': 'THIRD_PARTY_NOTICES.txt', ...skillAssets() }, useCodeCache: false, useSnapshot: false },
    },
  },
});
