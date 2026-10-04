import { describe, expect, it } from 'vite-plus/test';
import { commands, discover } from '../src/registry.ts';
describe('progressive command discovery', () => {
  it('finds bounded relevant commands with mutation disclosure', () => {
    const results = discover('publish memory PR');
    expect(results.length).toBeLessThanOrEqual(5);
    expect(results.some(result => result.command === 'git pr' && result.mutates)).toBe(true);
    expect(results.every(result => result.usage.startsWith('irudd-okf '))).toBe(true);
    expect(results.every(result => !('input' in result) && !('examples' in result))).toBe(true);
    expect(discover('nonexistent123term')).toEqual([]);
  });
  it('registers distinct commands and schemas', () => {
    expect(new Set(commands.map(item => item.command)).size).toBe(commands.length);
    expect(commands.find(item => item.command === 'write')?.input).toMatchObject({ type: 'object', additionalProperties: false });
  });
});
