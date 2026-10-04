import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, appendFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const directory = await mkdtemp(join(tmpdir(), 'okf-real-viewer-'));
const root = join(directory, '.okf'); await mkdir(join(root, 'nested'), { recursive: true });
const raw = '---\ntype: Rule\ntitle: Source\nproducer:\n  unknown: keep-this\n---\n\nSource facts.\n';
await writeFile(join(root, 'source.md'), raw);
await writeFile(join(root, 'referrer.md'), '---\ntype: Rule\ntitle: Referrer\n---\n\n[Source](source.md)\n');
await writeFile(join(root, 'index.md'), '# Memory\n\n[Nested](nested/)\n\n[Source](source.md?view=1#part)\n');
await writeFile(join(root, 'nested/index.md'), '# Nested navigation\n\n[Source](../source.md)\n');
const executable = resolve(process.argv[2] ?? 'build/irudd-okf');
const artifacts = resolve('docs/validation');
await mkdir(artifacts, { recursive: true });
const probe = createServer();
probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = probe.address().port; await new Promise(done => probe.close(done));
const origin = `http://127.0.0.1:${port}`;
let serverError = '';
const server = spawn(executable, ['--bundle', `repo=${root}`, 'serve', '--port', String(port)], {
  cwd: directory, env: { ...process.env, PATH: '/nonexistent', XDG_CONFIG_HOME: join(directory, 'config'), XDG_STATE_HOME: join(directory, 'state') },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', bytes => { serverError += bytes; });
let browser;
try {
let ready = false;
for (let attempt = 0; attempt < 150; attempt++) {
  if (server.exitCode !== null) throw new Error(`Native server exited: ${serverError}`);
  try { ready = (await fetch(`${origin}/wiki`)).ok; if (ready) break; } catch {}
  await new Promise(done => setTimeout(done, 100));
}
assert(ready, `Native server failed to start: ${serverError}`);
  browser = await chromium.launch({ executablePath: process.env.OKF_CHROMIUM_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
  const errors = []; const external = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (!request.url().startsWith(origin)) external.push(request.url()); });
  await page.goto(`${origin}/wiki?bundle=repo&path=index.md`);

  await page.locator('.markdown').getByRole('link', { name: 'Nested', exact: true }).click();
  await page.locator('.source-root').getByText(`File: ${root}/nested/index.md`, { exact: true }).waitFor();
  await page.goto(`${origin}/wiki?bundle=repo&path=source.md`);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Raw Markdown, including YAML metadata').fill(`${raw}\nMy browser draft.\n`);
  await appendFile(join(root, 'source.md'), '\nExternal edit.\n');
  await page.getByRole('button', { name: 'Preview changes' }).click(); await page.getByRole('button', { name: 'Save file' }).click();
  await page.getByRole('heading', { name: 'The file changed since you opened it' }).waitFor();
  assert((await page.locator('.compare').textContent())?.includes('External edit.'));
  await page.getByRole('button', { name: 'Continue with draft' }).click(); await page.getByRole('button', { name: 'Preview changes' }).click(); await page.getByRole('button', { name: 'Save file' }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).waitFor(); assert((await readFile(join(root, 'source.md'), 'utf8')).includes('unknown: keep-this'));
  await page.getByRole('button', { name: 'Rename', exact: true }).click(); await page.getByLabel('New file path').fill('nested/renamed.md');
  await page.getByRole('button', { name: 'Preview changes' }).click(); await page.getByRole('button', { name: 'Rename file' }).waitFor();
  const paths = await page.locator('.rename-changes summary').allTextContents();
  for (const path of ['source.md', 'nested/renamed.md', 'index.md', 'nested/index.md', 'referrer.md']) assert(paths.includes(path), `Missing rename preview path ${path}`);
  await page.screenshot({ path: join(artifacts, 'browser-rename.png'), fullPage: true });
  await appendFile(join(root, 'referrer.md'), '\nChanged after preview.\n');
  await page.getByRole('button', { name: 'Rename file' }).click();
  await page.getByText('Files affected by this rename changed after preview. Review a fresh preview.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Preview changes' }).waitFor(); assert.equal(await page.getByRole('button', { name: 'Rename file' }).count(), 0);
  await stat(join(root, 'source.md')); await assert.rejects(stat(join(root, 'nested/renamed.md')));
  await page.getByRole('button', { name: 'Preview changes' }).click(); await page.getByRole('button', { name: 'Rename file' }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).waitFor(); assert((await readFile(join(root, 'referrer.md'), 'utf8')).includes('[Source](nested/renamed.md)')); await assert.rejects(stat(join(root, 'source.md')));
  await page.getByRole('button', { name: 'Delete', exact: true }).click(); await page.getByRole('button', { name: 'Preview changes' }).click(); await page.getByRole('button', { name: 'Delete file' }).waitFor();
  assert((await page.locator('.delete-referrers').textContent())?.includes('referrer.md'));
  await page.getByRole('button', { name: 'Delete file' }).click(); await page.getByRole('button', { name: 'Edit', exact: true }).waitFor(); await assert.rejects(stat(join(root, 'nested/renamed.md')));
  await page.getByRole('button', { name: 'Add concept' }).click(); await page.getByLabel('File path within bundle').fill('created.md'); await page.getByLabel('Raw Markdown, including YAML metadata').fill('---\ntype: Rule\ntitle: Created\n---\n\nA new fact.');
  await page.getByRole('button', { name: 'Preview changes' }).click(); await page.getByRole('button', { name: 'Save file' }).click(); await page.getByRole('button', { name: 'Edit', exact: true }).waitFor(); await stat(join(root, 'created.md'));
  await page.getByRole('button', { name: 'Bundle index' }).click(); await page.getByRole('button', { name: 'Graph', exact: true }).click(); await page.locator('.graph-node').first().waitFor(); assert((await page.locator('.connections').textContent())?.includes('missing'));
  await page.screenshot({ path: join(artifacts, 'browser-graph.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Wiki', exact: true }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).waitFor();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Mobile page overflows horizontally.');
  await page.screenshot({ path: join(artifacts, 'browser-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  await writeFile(join(artifacts, 'browser-results.json'), JSON.stringify({ version: 1, platform: process.platform, arch: process.arch, client: 'standalone-native', passed: true, checks: ['directory-navigation', 'edit-conflict', 'metadata-preservation', 'exact-rename-preview', 'backlink-conflict-and-retry', 'delete-referrers', 'create', 'bounded-graph', 'mobile', 'no-external-fetches', 'no-browser-errors'] }, null, 2) + '\n');
  console.log('PASS real HTTP + file engine: directory links, edit conflict and hash rebase, preserved unknown YAML, complete rename preview, changed-backlink rejection and retry, rename rewrite, delete backlink warning, create, bounded graph and missing links.');
} finally {
  await browser?.close();
  if (server.exitCode === null) { server.kill('SIGTERM'); await Promise.race([once(server, 'exit'), new Promise(done => setTimeout(done, 2000))]); if (server.exitCode === null) server.kill('SIGKILL'); }
  await rm(directory, { recursive: true, force: true });
}
