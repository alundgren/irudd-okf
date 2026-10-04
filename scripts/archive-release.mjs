import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const asset = `irudd-okf-${process.platform}-${process.arch}.tar.gz`;
await mkdir('release', { recursive: true });
execFileSync('tar', ['-czf', `release/${asset}`, '-C', 'build', 'irudd-okf']);
const hash = createHash('sha256').update(await readFile(`release/${asset}`)).digest('hex');
await writeFile(`release/${asset}.sha256`, `${hash}  ${asset}\n`);
