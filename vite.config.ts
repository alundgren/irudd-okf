import { defineConfig } from 'vite-plus';
export default defineConfig({
  test: { include: ['packages/**/test/**/*.test.ts'], testTimeout: 30_000 },
  pack: {
    entry: ['packages/cli/src/main.ts'],
    deps: { alwaysBundle: [/.*/] },
    exe: {
      fileName: 'irudd-okf',
      seaConfig: { assets: { 'licenses.txt': 'THIRD_PARTY_NOTICES.txt', 'skill/SKILL.md': 'skills/okf/SKILL.md', 'skill/references/usage.md': 'skills/okf/references/usage.md', 'skills/okf-librarian/SKILL.md': 'skills/okf-librarian/SKILL.md', 'skills/okf-librarian/references/workflow.md': 'skills/okf-librarian/references/workflow.md', 'skills/okf-memory-reviewer/SKILL.md': 'skills/okf-memory-reviewer/SKILL.md', 'skills/okf-memory-reviewer/references/workflow.md': 'skills/okf-memory-reviewer/references/workflow.md' }, useCodeCache: false, useSnapshot: false },
    },
  },
});
