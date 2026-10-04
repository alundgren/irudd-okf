import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { command, hash, inventory, json, outside, readJson } from './lib.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const planned = fileURLToPath(new URL('../docs/planning/experiment-manifest.example.json', import.meta.url));
export async function download({ repository, destination }) {
  outside(repositoryRoot, destination);
  const plan = await readJson(planned), source = plan.repositories.find(r => r.name === repository);
  if (!source) throw new Error('Repository is not a protocol candidate.');
  await fs.mkdir(destination, { recursive: true });
  const license = await command('gh', ['api', `repos/${source.name}/license?ref=${source.commit}`]);
  if (license.code !== 0) throw new Error('Pinned license lookup failed; no archive downloaded.');
  const info = JSON.parse(license.stdout);
  const archive = path.join(destination, 'source.tar.gz');
  const output = await fs.open(archive, 'wx', 0o600);
  let status;
  try {
    status = await new Promise((resolve, reject) => {
      const child = spawn('gh', ['api', `repos/${source.name}/tarball/${source.commit}`], { stdio: ['ignore', output.fd, 'pipe'] });
      let stderr = ''; child.stderr.on('data', data => { stderr += data; });
      child.on('error', reject); child.on('close', code => resolve({ code, stderr }));
    });
  } finally { await output.close(); }
  if (status.code !== 0) throw new Error(`Pinned archive download failed: ${status.stderr}`);
  const raw = await fs.readFile(archive);
  await json(path.join(destination, 'provenance.json'), { repository: source.name, commit: source.commit, download_method: 'gh api pinned tarball', archive_sha256: hash(raw), license: { path: info.path, sha: info.sha, spdx: info.license?.spdx_id ?? 'NOASSERTION', license_text_sha256: hash(Buffer.from(info.content ?? '', 'base64')) }, redistribution: 'Third-party sources remain outside this MIT repository. Preserve upstream notices; license review is required before publishing transformations.', status: 'downloaded_not_transformed', human_license_review: 'pending' });
  return { archive, commit: source.commit };
}
export async function audit({ source, output }) {
  outside(repositoryRoot, source); outside(source, output);
  const files = await inventory(source, { allowSymlinks: true }), relevant = files.filter(f => !f.symlink_target && /(^|\/)(AGENTS\.md|CLAUDE\.md|SKILL\.md)$|(^|\/)(architecture|contributing|docs)\//i.test(f.path));
  const records = [];
  for (const file of relevant) {
    const text = await fs.readFile(path.join(source, file.path), 'utf8');
    records.push({ ...file, links: [...text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map(m => m[1]), is_skill: file.path.endsWith('/SKILL.md'), is_nested_instruction: file.path.endsWith('/AGENTS.md'), exact_duplicate_group: hash(text), token_count: null, token_count_reason: 'No selected-model tokenizer has been pinned.', contradiction_audit: 'pending_human_review', stale_reference_audit: 'pending_human_review', native_activation: 'unverified_until_runtime_capture' });
  }
  await json(output, { version: 1, study: 'natural_corpus_audit', source_file_count: files.length, guidance_file_count: records.length, symlinks_not_followed: files.filter(f => f.symlink_target), files: records, source_backed_concepts: null, source_backed_concepts_reason: 'Atomic concept extraction and two-human equivalence review are pending. File counts are not concept counts.' });
  return { guidance_files: records.length };
}
