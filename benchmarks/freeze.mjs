import fs from 'node:fs/promises';
import path from 'node:path';
import { hash, inventory } from './lib.mjs';

export async function verifyFreeze({ workspace, evaluator, methods, expectedFreezeHash }) {
  const raw = await fs.readFile(path.join(evaluator, 'freeze.json'));
  const digest = (await fs.readFile(path.join(evaluator, 'freeze.sha256'), 'utf8')).trim();
  if (hash(raw) !== digest || expectedFreezeHash && digest !== expectedFreezeHash) throw new Error('Frozen record digest changed.');
  const frozen = JSON.parse(raw);
  if (frozen.version !== 2) throw new Error('Legacy freeze is historical only; generate a new verified freeze.');
  const canonicalRaw = await fs.readFile(path.join(evaluator, 'canonical.json'));
  const tasksRaw = await fs.readFile(path.join(evaluator, 'tasks.hidden.json'));
  if (hash(canonicalRaw) !== frozen.canonical_sha256 || hash(JSON.parse(canonicalRaw)) !== frozen.canonical_hash) throw new Error('Frozen canonical concepts changed.');
  if (hash(tasksRaw) !== frozen.task_sha256 || hash(JSON.parse(tasksRaw)) !== frozen.task_hash) throw new Error('Frozen hidden tasks changed.');
  const manifests = new Map();
  for (const arm of frozen.methods) {
    const bytes = await fs.readFile(path.join(evaluator, `${arm}.manifest.json`));
    if (hash(bytes) !== frozen.manifest_sha256s[arm]) throw new Error(`Frozen manifest changed: ${arm}`);
    const manifest = JSON.parse(bytes);
    if (manifest.canonical_hash !== frozen.canonical_hash || manifest.count !== frozen.count || manifest.arm !== arm) throw new Error(`Frozen manifest does not match canonical corpus: ${arm}`);
    manifests.set(arm, manifest);
  }
  for (const arm of methods ?? frozen.methods) {
    if (!manifests.has(arm)) throw new Error(`Arm was not frozen: ${arm}`);
    if (hash(await inventory(path.join(workspace, arm))) !== hash(manifests.get(arm).generated_inventory)) throw new Error(`Frozen workspace changed before run: ${arm}`);
  }
  return { frozen, manifests, tasks: JSON.parse(tasksRaw), canonical: JSON.parse(canonicalRaw), digest };
}
