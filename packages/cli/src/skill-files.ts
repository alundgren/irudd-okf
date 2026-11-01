// The files each bundled skill installs. The installer and the native executable's assets both use this list,
// and a test compares it with the skills/ directory, so a new skill file cannot be left out of either.
export const skillFiles = {
  okf: ['SKILL.md', 'references/usage.md'],
  'okf-librarian': ['SKILL.md', 'references/workflow.md'],
  'okf-memory-reviewer': ['SKILL.md', 'references/workflow.md'],
  'bot-creator': ['SKILL.md', 'references/definition.md'],
  // agents/openai.yaml keeps Codex from invoking bot implicitly; SKILL.md frontmatter does the same for Claude.
  bot: ['SKILL.md', 'references/memory.md', 'agents/openai.yaml'],
} as const;
export type SkillName = keyof typeof skillFiles;
export const skillNames = Object.keys(skillFiles) as [SkillName, ...SkillName[]];
// The okf skill keeps its original asset prefix.
export const skillAsset = (name: SkillName, file: string) => `${name === 'okf' ? 'skill' : `skills/${name}`}/${file}`;
export const skillAssets = (): Record<string, string> => Object.fromEntries(skillNames.flatMap(name => skillFiles[name].map(file => [skillAsset(name, file), `skills/${name}/${file}`])));
