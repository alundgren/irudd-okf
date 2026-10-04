import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';

const input = resolve(process.argv[2] ?? 'artifacts');
const output = resolve(process.argv[3] ?? 'release');
if (input === output || output.startsWith(`${input}/`)) throw new Error('Keep release output outside the artifact input directory.');
const expected = new Set(['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64'].map(platform => `irudd-okf-${platform}.tar.gz`));
const found = new Map();
async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) await visit(file);
    else if (entry.isFile() && entry.name.endsWith('.tar.gz')) {
      if (!expected.has(entry.name) || found.has(entry.name)) throw new Error(`Unexpected or duplicate release archive: ${entry.name}`);
      const hash = createHash('sha256').update(await readFile(file)).digest('hex');
      const checksum = (await readFile(`${file}.sha256`, 'utf8')).trim();
      if (checksum !== `${hash}  ${entry.name}`) throw new Error(`Artifact checksum mismatch: ${entry.name}`);
      found.set(entry.name, { file, hash });
    }
  }
}
await visit(input);
if (found.size !== expected.size) throw new Error(`Missing native archives: ${[...expected].filter(name => !found.has(name)).join(', ')}`);
await mkdir(output, { recursive: true });
const hashes = [];
for (const name of [...expected].sort()) {
  const { file, hash } = found.get(name);
  const destination = join(output, name);
  try { await copyFile(file, destination, constants.COPYFILE_EXCL); }
  catch (error) {
    if (error.code !== 'EEXIST' || createHash('sha256').update(await readFile(destination)).digest('hex') !== hash) throw error;
  }
  hashes.push(`${hash}  ${name}`);
}
await writeFile(join(output, 'SHA256SUMS'), `${hashes.join('\n')}\n`);
console.log(JSON.stringify({ version: 1, directory: output, assets: [...expected].sort(), checksums: 'SHA256SUMS', verified: true }));
