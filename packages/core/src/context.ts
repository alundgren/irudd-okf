import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { OkfError, type Bundle, type MemoryContext, type Operation } from './contracts.ts';
import { ConfigSchema, decode } from './schemas.ts';
import { absent, operation, within, withLock, atomicReplace, atomicCreate, ensureDirectory, canonicalDirectory, normalizeSystemPath } from './files.ts';

interface Config { version: 1; bundles: Array<{ name: string; path: string; personal?: boolean }>; active: string[] }
const globalPath = () => {
  const configured = process.env.XDG_CONFIG_HOME;
  const directory = configured && path.isAbsolute(configured) ? configured : path.join(os.homedir(), '.config');
  return path.join(directory, 'irudd-okf', 'config.json');
};
const expand = (input: string, base: string) => path.resolve(base, input.startsWith('~/') ? path.join(os.homedir(), input.slice(2)) : input);
function checkName(name: string) { if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name)) throw new OkfError('INVALID_CONFIG', 'Bundle names must contain letters, numbers, hyphens or underscores.', { name }); }
async function readConfig(file: string): Promise<Config> {
  let raw: string;
  try { raw = await fs.readFile(file, 'utf8'); } catch (error) { if (absent(error)) return { version: 1, bundles: [], active: [] }; throw error; }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new OkfError('INVALID_CONFIG', 'Runtime configuration must be valid JSON.', { path: file }); }
  const config = decode(ConfigSchema, parsed, 'INVALID_CONFIG') as Config;
  if (!config || config.version !== 1 || !Array.isArray(config.bundles) || !Array.isArray(config.active) || config.active.some(name => typeof name !== 'string')) throw new OkfError('INVALID_CONFIG', 'Configuration requires version 1, bundles and active arrays.', { path: file });
  const names = new Set<string>();
  for (const bundle of config.bundles) {
    if (!bundle || typeof bundle.name !== 'string' || typeof bundle.path !== 'string' || !bundle.path.trim() || (bundle.personal !== undefined && typeof bundle.personal !== 'boolean')) throw new OkfError('INVALID_CONFIG', 'Each bundle needs a name and path.', { path: file });
    checkName(bundle.name);
    if (names.has(bundle.name)) throw new OkfError('INVALID_CONFIG', 'Duplicate bundle name.', { name: bundle.name });
    names.add(bundle.name);
  }
  if (config.active.some(name => !names.has(name))) throw new OkfError('INVALID_CONFIG', 'An active bundle is not registered.', { path: file });
  return config;
}
async function mount(name: string, root: string, kind: Bundle['kind']): Promise<Bundle> {
  checkName(name);
  let real: string;
  try { real = await canonicalDirectory(root); } catch (error) { if (absent(error)) throw new OkfError('BUNDLE_NOT_FOUND', 'The selected bundle does not exist.', { name, root }); throw error; }
  let writable = true;
  await fs.access(real, fs.constants.W_OK).catch(() => { writable = false; });
  return { name, root: real, kind, writable };
}
export function resolveContext(options: { cwd?: string; configPath?: string; explicitBundles?: Array<{ name: string; root: string }> } = {}): Operation<MemoryContext> {
  return operation(async () => {
    const cwd = await fs.realpath(options.cwd ?? process.cwd());
    const configPath = path.resolve(options.configPath ?? globalPath());
    let gitRoot: string | null = null;
    try { const result = await promisify(execFile)('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { maxBuffer: 65536 }); gitRoot = await fs.realpath(result.stdout.trim()); } catch { /* A standalone directory has no repository mount. */ }
    const bundles: Bundle[] = [];
    if (options.explicitBundles !== undefined) {
      for (const entry of options.explicitBundles) bundles.push(await mount(entry.name, expand(entry.root, cwd), 'explicit'));
    } else {
      const defaultRoot = path.join(gitRoot ?? cwd, '.okf');
      try { await fs.lstat(defaultRoot); bundles.push(await mount('repo', defaultRoot, 'repository')); } catch (error) { if (!absent(error)) throw error; }
      if (gitRoot) {
        const localPath = path.join(gitRoot, '.irudd-okf.json');
        const local = await readConfig(localPath);
        for (const entry of local.bundles) {
          const root = await normalizeSystemPath(expand(entry.path, gitRoot));
          if (!within(gitRoot, root) || entry.personal) throw new OkfError('UNSAFE_CONFIG', 'Repository configuration can mount only folders within its Git repository.', { root });
          if (!local.active.includes(entry.name)) continue;
          const real = await fs.realpath(root).catch(error => { if (absent(error)) throw new OkfError('BUNDLE_NOT_FOUND', 'A repository-configured bundle does not exist.', { root }); throw error; });
          if (!within(gitRoot, real)) throw new OkfError('UNSAFE_CONFIG', 'Repository configuration can mount only folders within its Git repository.', { root });
          if (local.active.includes(entry.name)) bundles.push(await mount(entry.name, root, 'repository'));
        }
      }
      const global = await readConfig(configPath);
      for (const entry of global.bundles) if (global.active.includes(entry.name)) bundles.push(await mount(entry.name, expand(entry.path, path.dirname(configPath)), entry.personal === false ? 'explicit' : 'personal'));
    }
    const names = new Set<string>();
    for (const bundle of bundles) { if (names.has(bundle.name)) throw new OkfError('BUNDLE_COLLISION', 'Active bundles must have different names.', { name: bundle.name }); names.add(bundle.name); }
    return { version: 1, cwd, gitRoot, bundles, configPath };
  });
}
export function initializeBundle(root: string): Operation<{ root: string }> {
  return operation(async () => {
    const absolute = path.resolve(root);
    await ensureDirectory(absolute);
    const bundle = await mount('new', absolute, 'explicit');
    await atomicCreate(path.join(bundle.root, 'index.md'), '---\nokf_version: "0.2"\n---\n\n# Knowledge\n').catch(error => { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new OkfError('ALREADY_EXISTS', 'Initialization never replaces an existing index.', { root: absolute }); throw error; });
    return { root: bundle.root };
  });
}
export function registerBundle(name: string, root: string, options: { configPath?: string; activate?: boolean; personal?: boolean } = {}): Operation<unknown> {
  return operation(async () => {
    const file = path.resolve(options.configPath ?? globalPath());
    const bundle = await mount(name, expand(root, process.cwd()), options.personal === false ? 'explicit' : 'personal');
    await fs.mkdir(path.dirname(file), { recursive: true });
    return withLock(path.dirname(file), async () => {
      const config = await readConfig(file);
      if (config.bundles.some(entry => entry.name === name)) throw new OkfError('BUNDLE_COLLISION', 'This bundle name is already registered.', { name });
      config.bundles.push({ name, path: bundle.root, personal: options.personal !== false });
      if (options.activate) config.active.push(name);
      await atomicReplace(file, JSON.stringify(config, null, 2) + '\n');
      return config;
    });
  });
}
export function unregisterBundle(name: string, options: { configPath?: string } = {}): Operation<unknown> {
  return operation(async () => {
    const file = path.resolve(options.configPath ?? globalPath());
    await fs.mkdir(path.dirname(file), { recursive: true });
    return withLock(path.dirname(file), async () => {
      const config = await readConfig(file);
      config.bundles = config.bundles.filter(entry => entry.name !== name);
      config.active = config.active.filter(entry => entry !== name);
      await atomicReplace(file, JSON.stringify(config, null, 2) + '\n');
      return config;
    });
  });
}
