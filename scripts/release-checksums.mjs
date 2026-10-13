import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const directory = resolve(process.argv[2]);
const expected = ['irudd-okf-darwin-arm64.tar.gz', 'irudd-okf-darwin-x64.tar.gz', 'irudd-okf-linux-arm64.tar.gz', 'irudd-okf-linux-x64.tar.gz', 'irudd-okf-windows-x64.zip'];
assert.deepEqual((await readdir(directory)).sort(), expected, 'A release requires every supported platform archive.');
const sums = [];
for (const name of expected) {
  const bytes = await readFile(join(directory, name));
  assert(bytes.length > 0, `Empty archive: ${name}`);
  sums.push(`${createHash('sha256').update(bytes).digest('hex')}  ${name}`);
}
await writeFile(join(directory, 'SHA256SUMS'), sums.join('\n') + '\n');
