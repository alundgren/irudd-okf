import { hash } from './lib.mjs';

export function parseTrace(raw) {
  const events = [], malformed = [];
  for (const [index, line] of raw.split('\n').entries()) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); } catch { malformed.push(index + 1); }
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
  const key = r => JSON.stringify([r.arm, r.task_id, r.launch_cwd, r.applicable_concept_ids, r.repetition ?? 0]);
  const groups = new Map();
  for (const result of results) {
    const group = groups.get(key(result)) ?? [];
    group.push(result); groups.set(key(result), group);
  }
  for (const group of groups.values()) for (const [from, to] of [[100, 1000], [1000, 10000], [100, 10000]]) {
    const a = group.find(r => r.count === from), b = group.find(r => r.count === to);
    rows.push({ key: key(group[0]), from, to, status: a && b ? 'paired' : 'missing_cell', input_change: a && b && a.metrics.recurring_input_tokens !== null && b.metrics.recurring_input_tokens !== null ? b.metrics.recurring_input_tokens - a.metrics.recurring_input_tokens : null, coverage_change: a && b ? b.machine_grade.coverage - a.machine_grade.coverage : null });
  }
  return rows;
}
export function grade(task, answer, diff = '') {
  const content = (answer + '\n' + diff).toLowerCase();
  const hits = task.checks.map(alternatives => alternatives.some(word => content.includes(word.toLowerCase())));
  return { kind: 'automated_string_check_screen_only', coverage: hits.filter(Boolean).length / hits.length, hits, task_correctness: null, correctness_reason: 'String checks cannot confirm semantic correctness. Two blinded human ratings and adjudication remain pending.' };
}
