import { Schema } from 'effect';
import { OkfError } from './contracts.ts';

export const ConfigSchema = Schema.Struct({ version: Schema.Literal(1), bundles: Schema.Array(Schema.Struct({ name: Schema.String, path: Schema.String, personal: Schema.optionalKey(Schema.Boolean) })), active: Schema.Array(Schema.String) });
export const WriteSchema = Schema.Struct({ bundle: Schema.String, path: Schema.String, raw: Schema.String, expectedHash: Schema.NullOr(Schema.String), authorizePersonal: Schema.optionalKey(Schema.Boolean) });
export const DeleteSchema = Schema.Struct({ bundle: Schema.String, path: Schema.String, expectedHash: Schema.String, authorizePersonal: Schema.optionalKey(Schema.Boolean) });
export const RenameSchema = Schema.Struct({ ...DeleteSchema.fields, newPath: Schema.String, updateLinks: Schema.optionalKey(Schema.Boolean), previewHash: Schema.optionalKey(Schema.String) });
export function decode<S extends Schema.ConstraintDecoder<unknown>>(schema: S, value: unknown, code = 'INVALID_REQUEST') {
  try { return Schema.decodeUnknownSync(schema)(value); }
  catch { throw new OkfError(code, code === 'INVALID_CONFIG' ? 'Runtime configuration does not match version 1.' : 'The request contains missing or invalid fields.'); }
}
