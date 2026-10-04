import fs from 'node:fs/promises';
import path from 'node:path';
import { hash, json, outside, write, inventory, shuffle } from './lib.mjs';

export const arms = ['nested', 'flat', 'skills', 'skills-grouped', 'okf-path', 'okf-retrieval', 'okf-cli'];
const categories = ['tests', 'architecture', 'ux', 'accessibility', 'formatting', 'release', 'data', 'compatibility', 'documentation', 'debugging'];
const fixed = [
  { title: 'Checkout execution boundary', category: 'architecture', scope: 'packages/checkout', text: 'Checkout orchestration calls the payment gateway through payments/port.ts. UI code must never import payments/gateway.ts. Inject the port for tests.' },
  { title: 'Payment retry behavior', category: 'architecture', scope: 'packages/checkout', text: 'A timeout after gateway submission leaves payment outcome unknown. Use the original idempotency key for a retry and reconcile status before creating another payment.' },
  { title: 'Checkout submission accessibility', category: 'ux', scope: 'packages/checkout', text: 'During checkout submission keep the submit button mounted, disable duplicate submission, set aria-busy on the form, and announce completion or failure in the existing live region.' },
  { title: 'Checkout package workflow', category: 'tests', scope: 'packages/checkout', text: 'The benchmark checkout package uses npm ci and npm test. Its package-lock.json is required; do not replace it with another package manager lockfile.' },
  { title: 'Invoice package workflow', category: 'tests', scope: 'packages/invoices', text: 'The benchmark invoices package uses pnpm install --frozen-lockfile and pnpm test. This instruction applies only to packages/invoices.' },
  { title: 'Recorded incident evidence', category: 'documentation', scope: 'packages/checkout', text: 'Capture a new incident only after reproducing it. Include affected path, observed failure, successful mitigation, and a verification command. Update an existing matching incident instead of adding a duplicate.' },
];
export function concepts(count, seed = 20261004) {
  if (![100, 1000, 10000].includes(count)) throw new Error('Scale must be 100, 1000, or 10000.');
  const all = [...fixed];
  for (let i = fixed.length; i < count; i++) {
    const category = categories[i % categories.length];
    const packageName = i % 2 ? 'checkout-tools' : 'invoices';
    const scope = `packages/${packageName}/cases/case-${String(i).padStart(5, '0')}`;
    const subject = `record-${String(i).padStart(5, '0')}`;
    const action = {
      tests: `Run the fixture test for ${subject} after modifying ${scope}.`,
      architecture: `Route ${subject} persistence through its local adapter in ${scope}/adapter.ts.`,
      ux: `Display the ${subject} operation outcome in ${scope}/status.ts using its existing status message.`,
      accessibility: `Associate ${subject} input errors with the field using aria-describedby in ${scope}/form.ts.`,
      formatting: `Keep the ${subject} export entries alphabetically ordered in ${scope}/exports.ts.`,
      release: `Build ${subject} before packaging its artifact from ${scope}/release.ts.`,
      data: `Remove the ${subject} session identifier before logging events from ${scope}/logging.ts.`,
      compatibility: `Preserve the optional ${subject} callback argument in ${scope}/api.ts.`,
      documentation: `Update the ${subject} command example when its flags change in ${scope}/README.md.`,
      debugging: `Record the ${subject} response status before restarting its worker in ${scope}/worker.ts.`,
    }[category];
    all.push({ title: `${subject} ${category}`, category, scope, text: action });
  }
  // Random IDs reveal neither applicability nor a priority ordering.
  return all.map((item, index) => ({ ...item, id: hash(`${seed}:${index}`).slice(0, 16), source: { path: 'benchmarks/corpus.mjs', template: index < fixed.length ? `fixed:${index}` : item.category }, synthetic: true }));
}
export const tasks = [
  { id: 'architecture', cwd: 'packages/checkout', prompt: 'Review a checkout refactor that calls the payment implementation directly from the UI and creates a new request after a network timeout. Explain the changes needed before approval. Cite the repository guidance you used.', relevant: [0, 1], checks: [['payments/port.ts', 'port'], ['idempotency', 'same key', 'original key'], ['reconcil', 'status']] },
  { id: 'ux-gotcha', cwd: 'packages/checkout', prompt: 'Review a checkout submission interaction that removes the submit control while waiting and then inserts a plain error paragraph. Explain what needs changing for this repository. Cite the repository guidance you used.', relevant: [2], checks: [['mounted', 'keep', 'remain'], ['aria-busy'], ['live region', 'announce'], ['duplicate', 'disable']] },
  { id: 'sibling-isolation', cwd: 'packages/checkout', prompt: 'Which install and test commands should I run for the current package, and should I replace its lockfile? Cite the relevant guidance.', relevant: [3], distractors: [4], checks: [['npm ci'], ['npm test'], ['package-lock']] },
  { id: 'conflict', cwd: 'packages/checkout', prompt: 'Set up the current package. My personal workflow may use a different package manager. Describe the commands or ask for the clarification required by the stated conflict convention. Cite both sources.', relevant: [3], checks: [['npm', 'conflict', 'clarif']] },
  { id: 'memory-update', cwd: 'packages/checkout', prompt: 'I reproduced duplicate checkout payments after retrying a timed-out request. Retrying with the original request key and reconciling status fixed the reproduction. The verification was npm test. Capture that observation in the current repository memory, updating an existing matching entry if one exists. Do not edit personal memory.', relevant: [1, 5], checks: [['idempotency', 'original'], ['npm test']] },
];
const notice = 'Synthetic benchmark fork policy. These rules describe this fixture only.\n';
const block = concept => `## ${concept.title}\n\nApplies to ${concept.scope}.\n\n${concept.text}\n`;
const okf = concept => `---\ntype: Policy\ntitle: ${concept.title}\ndescription: Synthetic policy for ${concept.scope}\ntags: [${concept.category}, synthetic]\n---\n\n${notice}\n${block(concept)}`;
const locator = variant => `${notice}\nRepository guidance is in .okf/index.md relative to the repository root. Read the relevant category index and concept files before answering or editing. ${variant === 'okf-retrieval' ? 'Search .okf for the current path and topic, read matching concepts, and report when no guidance matches.' : 'Route payment boundaries and retries to architecture, submission interactions to ux, and package commands to tests.'}\n`;

export async function generate({ workspace, evaluator, count = 100, seed = 20261004, methods = arms, personal = false, convention = 'repo-wins' }) {
  outside(workspace, evaluator);
  if (!['repo-wins', 'ask-on-conflict'].includes(convention)) throw new Error('Unknown conflict convention.');
  const canonical = concepts(count, seed);
  await fs.mkdir(workspace, { recursive: true });
  const manifests = [];
  for (const arm of methods) {
    if (!arms.includes(arm)) throw new Error('Unknown arm.');
    const root = path.join(workspace, arm);
    await fs.mkdir(root, { recursive: false });
    await write(root, 'packages/checkout/package.json', '{"name":"benchmark-checkout","scripts":{"test":"node --test"}}\n');
    await write(root, 'packages/checkout/package-lock.json', '{"name":"benchmark-checkout","lockfileVersion":3,"packages":{}}\n');
    await write(root, 'packages/invoices/README.md', 'Synthetic invoices package.\n');
    await write(root, 'packages/checkout/payments/port.ts', 'export interface PaymentPort { submit(key: string): Promise<void>; status(key: string): Promise<string> }\n');
    await write(root, 'packages/checkout/payments/gateway.ts', '// Synthetic payment implementation used only by this benchmark fork.\n');
    for (const concept of canonical.slice(fixed.length)) await write(root, `${concept.scope}/README.md`, `Synthetic benchmark-only case directory for ${concept.title}.\n`);
    const map = [];
    if (arm === 'nested') {
      await write(root, 'AGENTS.md', `${notice}\nRead guidance linked from the package AGENTS.md for the current task.\n`);
      for (const packageName of ['checkout', 'invoices', 'checkout-tools']) {
        await write(root, `packages/${packageName}/AGENTS.md`, `${notice}\nRead ../../guidance/architecture.md, ../../guidance/ux.md, ../../guidance/tests.md or other matching category documents. Apply each rule only to its stated path.\n`);
      }
      for (const category of categories) {
        const file = `guidance/${category}.md`, selected = canonical.filter(c => c.category === category);
        await write(root, file, notice + '\n' + selected.map(block).join('\n'));
        selected.forEach(c => map.push({ id: c.id, file, content_hash: hash(c.text) }));
      }
    } else if (arm === 'flat') {
      const content = notice + '\n' + canonical.map(block).join('\n');
      await write(root, 'AGENTS.md', content);
      canonical.forEach(c => map.push({ id: c.id, file: 'AGENTS.md', content_hash: hash(c.text) }));
    } else if (arm.startsWith('skills')) {
      await write(root, 'AGENTS.md', notice + '\nUse native repository skills relevant to the current task. Rules apply only to their stated paths.\n');
      const groups = arm === 'skills' ? canonical.map(c => [c]) : categories.map(category => canonical.filter(c => c.category === category));
      for (const group of groups) {
        const name = arm === 'skills' ? `policy-${hash(group[0].title).slice(0, 12)}` : `policy-${group[0].category}`;
        const file = `.agents/skills/${name}/SKILL.md`;
        await write(root, file, `---\nname: ${name}\ndescription: Guidance for ${group[0].category} tasks in ${arm === 'skills' ? group[0].scope : 'this synthetic repository'}\n---\n\n${notice}\n${group.map(block).join('\n')}`);
        group.forEach(c => map.push({ id: c.id, file, content_hash: hash(c.text) }));
      }
    } else {
      await write(root, 'AGENTS.md', locator(arm));
      await write(root, 'packages/checkout/AGENTS.md', 'Read the repository .okf locator and apply guidance only to its stated path.\n');
      await write(root, '.okf/index.md', '---\nokf_version: "0.2"\n---\n\n# Synthetic benchmark guidance\n\n' + categories.map(c => `- [${c}](${c}/index.md)`).join('\n') + '\n');
      for (const category of categories) {
        const selected = canonical.filter(c => c.category === category);
        await write(root, `.okf/${category}/index.md`, `# ${category}\n\n` + selected.map(c => `- [${c.title}](${hash(c.title).slice(0, 12)}.md)`).join('\n') + '\n');
        for (const c of selected) {
          const file = `.okf/${category}/${hash(c.title).slice(0, 12)}.md`;
          await write(root, file, okf(c));
          map.push({ id: c.id, file, content_hash: hash(c.text) });
        }
      }
      if (arm === 'okf-cli') await write(root, '.agents/skills/okf-guidance/SKILL.md', `---\nname: okf-guidance\ndescription: Read and search current repository OKF task guidance with the optional installed CLI\n---\n\nLaunch from packages/checkout. Pass --bundle repo=../../.okf${personal ? ' --bundle personal=../../assigned-personal' : ''} to every irudd-okf command so only assigned bundles are active. Use irudd-okf with these flags and context to inspect scope, search QUERY to find guidance, and read repo PATH to read it. If the executable is unavailable, report that the CLI treatment cannot run. Do not activate unassigned bundles.\n`);
    }
    if (personal) {
      await write(root, 'assigned-personal/index.md', '# Assigned personal preferences\n\n- [Package manager](package-manager.md)\n');
      await write(root, 'assigned-personal/package-manager.md', '---\ntype: Preference\ntitle: Personal package manager preference\n---\n\nI prefer pnpm for JavaScript package installation and tests. This is a personal preference.\n');
    }
    const active = [{ name: 'repo', path: arm.startsWith('okf') ? '.okf' : '.', kind: 'repository' }, ...(personal ? [{ name: 'personal', path: 'assigned-personal', kind: 'personal' }] : [])];
    const manifest = { version: 1, study: 'synthetic_interface_feasibility', count, seed, arm, canonical_hash: hash(canonical), transformed_concept_hash: hash(map.map(m => [m.id, m.content_hash]).sort()), source_map: map, active_bundles: active, conflict_convention: convention, human_equivalence_review: { status: 'pending', reviewers: [], adjudication: null }, generated_inventory: await inventory(root) };
    await json(path.join(evaluator, `${arm}.manifest.json`), manifest);
    manifests.push(manifest);
  }
  await json(path.join(evaluator, 'canonical.json'), canonical);
  const hiddenTasks = tasks.map(t => ({ ...t, applicable_concept_ids: t.relevant.map(i => canonical[i].id), fixed_facts_hash: hash(t.relevant.map(i => canonical[i])) }));
  await json(path.join(evaluator, 'tasks.hidden.json'), hiddenTasks);
  const fileHash = async name => hash(await fs.readFile(path.join(evaluator, name)));
  const manifestHashes = Object.fromEntries(await Promise.all(methods.map(async arm => [arm, await fileHash(`${arm}.manifest.json`)])));
  await json(path.join(evaluator, 'freeze.json'), { version: 2, status: 'instrumentation_only_human_review_pending', count, seed, canonical_hash: hash(canonical), canonical_sha256: await fileHash('canonical.json'), task_hash: hash(hiddenTasks), task_sha256: await fileHash('tasks.hidden.json'), manifest_sha256s: manifestHashes, methods, personal, convention, randomization: shuffle(methods, seed), synthetic_rule_review: 'pending_all_instances', source_backed_10000: { status: 'unavailable', reason: 'No human-audited source-backed concept corpus has been prepared.' } });
  await fs.writeFile(path.join(evaluator, 'freeze.sha256'), await fileHash('freeze.json') + '\n');
  return manifests;
}
