import { describe, expect, it } from 'vite-plus/test';
import { internalPath } from '../src/git.ts';

describe('Git publication internal directories', () => {
  it('rejects case aliases for internal directories on Windows and macOS', () => {
    expect(internalPath('.IRUDD-OKF/recovery/note.md', 'win32')).toBe(true);
    expect(internalPath('topics/.Git/note.md', 'win32')).toBe(true);
    expect(internalPath('.IRUDD-OKF/recovery/note.md', 'darwin')).toBe(true);
    expect(internalPath('topics/.Git/note.md', 'darwin')).toBe(true);
    expect(internalPath('topics/.irudd-okf/note.md', 'linux')).toBe(true);
    expect(internalPath('.IRUDD-OKF/recovery/note.md', 'linux')).toBe(false);
    expect(internalPath('topics/.Git/note.md', 'linux')).toBe(false);
  });

  it('allows similarly named ordinary files and directories on either platform', () => {
    for (const platform of ['win32', 'darwin', 'linux'] as const) {
      expect(internalPath('topics/.irudd-okf-note.md', platform)).toBe(false);
      expect(internalPath('.GIT-notes/note.md', platform)).toBe(false);
    }
  });
});
