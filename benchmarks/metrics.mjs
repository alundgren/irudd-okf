import { hash } from './lib.mjs';

export function parseTrace(raw) {
  const events = [], malformed = [];
  for (const [index, line] of raw.split('\n').entries()) {
    if (!line.trim()) continue;
    try { const event = JSON.parse(line); if (!event || typeof event !== 'object' || Array.isArray(event) || typeof event.type !== 'string') throw new Error('Not a runtime event.'); events.push(event); } catch { malformed.push(index + 1); }
  }
  return { events, malformed };
}
export function measure(events) {
  const usages = events.filter(e => e.type === 'turn.completed' && e.usage).map(e => e.usage);
  const sum = field => usages.length && usages.every(u => Number.isFinite(u[field])) ? usages.reduce((total, u) => total + u[field], 0) : null;
  const input = sum('input_tokens'), cached = sum('cached_input_tokens'), output = sum('output_tokens');
  const requests = events.filter(e => e.type === 'request.context' && Number.isFinite(e.logical_context_tokens));
  const commands = events.filter(e => e.type === 'item.completed' && ['command_execution', 'mcp_tool_call'].includes(e.item?.type)).map(e => e.item);
  const contents = new Map(commands.map(item => { const content = item.aggregated_output ?? JSON.stringify(item.result ?? ''); return [hash(content), content]; }));
  return {
    recurring_input_tokens: input, recurring_output_tokens: output, cached_input_tokens: cached,
    uncached_input_tokens: input !== null && cached !== null ? input - cached : null,
    total_input_output_tokens: input !== null && output !== null ? input + output : null,
    cache_write_input_tokens: sum('cache_write_input_tokens'), reasoning_output_tokens: sum('reasoning_output_tokens'),
    cost: null, cost_reason: 'No dated provider price schedule or per-request bill has been frozen.',
    usage_reason: usages.length ? 'Runtime turn usage; provider per-request billing detail is unavailable unless supplied separately.' : 'Runtime emitted no completed-turn usage.',
    peak_logical_context_tokens: requests.length ? Math.max(...requests.map(e => e.logical_context_tokens)) : null,
    peak_context_reason: requests.length ? 'Actual request.context trace.' : 'Codex JSONL does not expose the full provider request context. File sizes and cumulative input usage are not peak-context measurements.',
    tool_calls: commands.length, tool_errors: commands.filter(c => c.error || c.exit_code !== undefined && c.exit_code !== 0).length,
    unique_tool_content_hashes: [...contents.keys()], unique_tool_content_bytes: [...contents.values()].reduce((n, value) => n + Buffer.byteLength(value), 0),
    tool_latency_ms: null, tool_latency_reason: 'Codex command events do not expose command duration.',
    actual_loaded_instruction_chain: null, actual_loaded_instruction_reason: 'No full prompt trace was emitted. File inventory is only expected discovery evidence.',
    actual_loaded_skill_descriptors: null, actual_loaded_skill_reason: 'No native skill registry prompt trace was emitted. Included, shortened and omitted entries cannot be inferred from source files.',
    provider_request_count: requests.length || null,
  };
}
export function pairedScaleRows(results) {
  const rows = [];
  const key = r => JSON.stringify([r.repository_id, r.arm, r.task_id, r.launch_cwd, r.repetition ?? 0]);
  const groups = new Map();
  for (const result of results) {
    const group = groups.get(key(result)) ?? [];
    group.push(result); groups.set(key(result), group);
  }
  for (const group of groups.values()) for (const [from, to] of [[100, 1000], [1000, 10000], [100, 10000]]) {
    const left = group.filter(r => r.count === from), right = group.filter(r => r.count === to);
    const [a] = left, [b] = right;
    let status = 'paired', reasons = [];
    if (left.length > 1 || right.length > 1) { status = 'rejected_duplicate_cells'; reasons.push('A scale has multiple observations for the same repository, arm, task, cwd and repetition.'); }
    else if (!a || !b) status = 'missing_cell';
    else if ([a, b].some(r => r.status !== 'completed' || r.timed_out)) { status = 'rejected_failed_cell'; reasons.push('Both executions must complete without timeout.'); }
    else if ([a, b].some(r => r.freeze_validation?.status !== 'verified' || !r.freeze_validation.freeze_sha256)) { status = 'rejected_unverified_freeze'; reasons.push('Legacy or unverified freezes cannot produce scale deltas.'); }
    else if ([a, b].some(r => r.exit_code !== 0 || r.runtime?.code !== 0 || r.signal || r.runtime?.signal || r.runtime?.timed_out || r.failure !== null)) { status = 'rejected_failed_cell'; reasons.push('Both executions and their runtime records must have exit 0, no signal, no timeout and no failure.'); }
    else {
      const fields = ['repository_id', 'prompt_hash', 'rubric_hash', 'fixed_facts_hash', 'opportunity_hash', 'assigned_personal_hash', 'applicable_concept_ids', 'conflict_convention', 'personal', 'active_bundles', 'runtime_settings'];
      for (const r of [a, b]) {
        const config = r.comparison_config;
        if (!config || hash(config) !== r.comparison_config_hash || fields.some(field => config[field] === undefined) || ['model', 'effort', 'runtime_version', 'adapter_digest'].some(field => !config.runtime_settings?.[field])) reasons.push(`Run ${r.id ?? '?'} lacks intact comparison configuration and actual runtime identity.`);
        if (config && (config.prompt_hash !== r.prompt_hash || hash(config.applicable_concept_ids) !== hash(r.applicable_concept_ids) || config.runtime_settings?.model !== r.runtime?.model || config.runtime_settings?.effort !== r.runtime?.effort || config.runtime_settings?.runtime_version !== r.runtime?.runtime_version || hash(config.runtime_settings?.runtime_command ?? null) !== hash(r.runtime?.runtime_command ?? null))) reasons.push(`Run ${r.id ?? '?'} result metadata differs from comparison configuration.`);
      }
      if (a.comparison_config_hash !== b.comparison_config_hash) reasons.push('Task prompt, rubric, fixed facts, source opportunity, scope convention or runtime configuration differs across scales.');
      if (reasons.length) status = 'rejected_mismatch';
    }
    rows.push({ key: key(group[0]), from, to, status, reasons, run_ids: [...left, ...right].map(r => r.id ?? null), input_change: status === 'paired' && Number.isFinite(a.metrics?.recurring_input_tokens) && Number.isFinite(b.metrics?.recurring_input_tokens) ? b.metrics.recurring_input_tokens - a.metrics.recurring_input_tokens : null, coverage_change: status === 'paired' && Number.isFinite(a.machine_grade?.coverage) && Number.isFinite(b.machine_grade?.coverage) ? b.machine_grade.coverage - a.machine_grade.coverage : null });
  }
  return rows;
}
export function grade(task, answer, diff = '') {
  const content = (answer + '\n' + diff).toLowerCase();
  const hits = task.checks.map(alternatives => alternatives.some(word => content.includes(word.toLowerCase())));
  return { kind: 'automated_string_check_screen_only', coverage: hits.filter(Boolean).length / hits.length, hits, task_correctness: null, correctness_reason: 'String checks cannot confirm semantic correctness. Two blinded human ratings and adjudication remain pending.' };
}
