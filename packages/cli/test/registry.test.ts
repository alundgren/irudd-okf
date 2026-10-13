import { describe, expect, it } from 'vite-plus/test';
import { commands, discover, navigate } from '../src/registry.ts';
describe('progressive command discovery', () => {
  it('finds bounded relevant commands with mutation disclosure', () => {
    const results = discover('publish memory PR');
    expect(results.length).toBeLessThanOrEqual(5);
    expect(results.some(result => result.command === 'git pr' && result.mutates)).toBe(true);
    expect(results.every(result => result.usage.startsWith('irudd-okf '))).toBe(true);
    expect(results.every(result => !('input' in result) && !('examples' in result))).toBe(true);
    expect(discover('nonexistent123term')).toEqual([]);
  });
  it('navigates groups and provides exact machine-readable library outputs and guarded review errors',()=>{
    expect(navigate('change').entries.some(item=>item.command==='change recover')).toBe(true);
    expect(navigate().entries.some(item=>item.command==='change' && item.group)).toBe(true);
    const review=commands.find(item=>item.command==='change review');
    expect(review?.outputSchema).toMatchObject({schema:{properties:{display:{type:'object'},humanRequired:{type:'boolean'}}}});
    expect(review?.errors?.some(item=>item.code==='REVIEW_CONFLICT')).toBe(true);
  });
  it('registers distinct commands and schemas', () => {
    expect(new Set(commands.map(item => item.command)).size).toBe(commands.length);
    expect(commands.find(item => item.command === 'write')?.input).toMatchObject({ type: 'object', additionalProperties: false });
    expect(commands.find(item => item.command === 'skill install')?.input).toMatchObject({ properties: { name: { default: 'okf', enum: ['okf', 'okf-librarian', 'okf-memory-reviewer'] } } });
  });
  it('publishes complete memory commands and request-file schemas from core', () => {
    for (const command of ['list', 'profile', 'namespaces', 'bootstrap', 'template', 'review', 'verify', 'task', 'lifecycle', 'audit', 'maintenance preview', 'maintenance apply', 'maintenance inspect', 'maintenance recover', 'migration preview', 'migration apply']) expect(commands.find(item => item.command === command)).toBeDefined();
    expect(commands.find(item => item.command === 'template')?.fileInput).toMatchObject({ schema: { additionalProperties: false, properties: { kind: { enum: ['procedural', 'episodic', 'semantic'] } } } });
    expect(commands.find(item => item.command === 'migration preview')?.fileInput).toBeDefined();
    expect(commands.find(item => item.command === 'maintenance apply')?.mutates).toBe(true);
    expect(commands.find(item => item.command === 'maintenance inspect')?.mutates).toBe(false);
    expect(commands.find(item => item.command === 'review')?.description).toContain('does not authenticate identity');
  });
});
