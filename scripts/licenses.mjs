import { readFile, readdir, writeFile } from 'node:fs/promises';
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const sections = [
  `irudd-okf\n${await readFile('LICENSE', 'utf8')}`,
  `Node.js 26.10.0 and its included libraries\n${await readFile('licenses/Node-26.10.0.txt', 'utf8')}`,
];
for (const [directory, pkg] of Object.entries(lock.packages)) {
  if (!directory.startsWith('node_modules/') || pkg.dev || pkg.link) continue;
  const files = (await readdir(directory)).filter(name => /^licen[sc]e(?:[.-]|$)/i.test(name)).sort();
  const texts = await Promise.all(files.map(name => readFile(`${directory}/${name}`, 'utf8')));
  if (!texts.length && (directory.startsWith('node_modules/@redis/') || directory === 'node_modules/redis')) texts.push(await readFile('licenses/node-redis.txt', 'utf8'));
  if (!texts.length) throw new Error(`Missing license text for ${directory}`);
  sections.push(`${directory.replace('node_modules/', '')} ${pkg.version}\n${texts.join('\n')}`);
}
await writeFile('THIRD_PARTY_NOTICES.txt', sections.join('\n\n========================================\n\n'));
