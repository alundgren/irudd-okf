import { Effect } from 'effect';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { OkfError } from '../../core/src/contracts.ts';

export const readJson = (file: string) => Effect.tryPromise({
  try: async () => {
    const raw = await readFile(resolve(file), 'utf8');
    if (Buffer.byteLength(raw) > 2_000_000) throw new OkfError('INVALID_INPUT', 'Request files must be at most 2 MB.');
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new OkfError('INVALID_INPUT', 'Request files must contain valid JSON.'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new OkfError('INVALID_INPUT', 'Request files must contain a JSON object.');
    return value as Record<string, unknown>;
  },
  catch: error => error instanceof OkfError ? error : new OkfError('FILE_READ_FAILED', 'Could not read the request file.', { cause: String(error) }),
});

export function bindFields(data: Record<string, unknown>, fields: Record<string, unknown>) {
  for (const [key, value] of Object.entries(fields)) {
    if (key in data && data[key] !== value) throw new OkfError('INVALID_INPUT', `The request ${key} conflicts with the command argument.`);
  }
  return { ...data, ...fields };
}
