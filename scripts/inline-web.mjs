import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
let html = await readFile('web-dist/index.html', 'utf8');
for (const match of [...html.matchAll(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g)]) {
  const source = await readFile(resolve('web-dist', match[1].replace(/^\//, '')), 'utf8');
  html = html.replace(match[0], `<script type="module">${source.replaceAll('</script', '<\\/script')}</script>`);
}
for (const match of [...html.matchAll(/<link[^>]*href="([^"]+\.css)"[^>]*>/g)]) {
  html = html.replace(match[0], `<style>${await readFile(resolve('web-dist', match[1].replace(/^\//, '')), 'utf8')}</style>`);
}
await writeFile('web-dist/viewer.html', html);
