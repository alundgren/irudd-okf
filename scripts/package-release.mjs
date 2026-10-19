import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const output = resolve(process.argv[2]);
const platforms = { linux: ['x64', 'arm64'], darwin: ['x64', 'arm64'], win32: ['x64'] };
assert(platforms[process.platform]?.includes(process.arch), 'Unsupported release platform.');
const name = process.platform === 'win32' ? 'irudd-okf.exe' : 'irudd-okf';
const platform = process.platform === 'win32' ? 'windows' : process.platform;
const extension = process.platform === 'win32' ? 'zip' : 'tar.gz';
const staging = await realpath(await mkdtemp(join(tmpdir(), 'okf-release-')));
try {
  const contents = join(staging, 'contents');
  await mkdir(contents);
  await mkdir(output, { recursive: true });
  const files = [name, 'LICENSE', 'THIRD_PARTY_NOTICES.txt', 'README.md'];
  for (const file of files) await copyFile(resolve(file === name ? 'build' : '.', file), join(contents, file));
  const archive = join(output, `irudd-okf-${platform}-${process.arch}.${extension}`);
  if (process.platform === 'win32') {
    execFileSync('powershell.exe', ['-NoProfile', '-Command', "$ErrorActionPreference = 'Stop'; Compress-Archive -Path (Join-Path $env:OKF_ARCHIVE_CONTENTS '*') -DestinationPath $env:OKF_ARCHIVE_OUTPUT"], {
      env: { ...process.env, OKF_ARCHIVE_CONTENTS: contents, OKF_ARCHIVE_OUTPUT: archive }, stdio: 'inherit',
    });
  } else {
    execFileSync('tar', ['-czf', archive, '-C', contents, ...files], { stdio: 'inherit' });
  }
  const extracted = join(staging, 'extracted');
  await mkdir(extracted);
  execFileSync('tar', ['-xf', archive, '-C', extracted]);
  for (const file of files) assert.deepEqual(await readFile(join(extracted, file)), await readFile(join(contents, file)));
  console.log(`Packaged ${archive}`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
