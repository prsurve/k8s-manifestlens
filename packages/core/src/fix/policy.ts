import { isMap, parseDocument } from 'yaml';
import type { FixPolicy } from './types.js';

export class FixPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FixPolicyError';
  }
}

/** Parse a fix policy: `params:` maps a parameter name to the value fixes should use. */
export function parseFixPolicy(text: string, origin = 'fix policy'): FixPolicy {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) {
    throw new FixPolicyError(
      `${origin}: ${doc.errors[0]?.message.split('\n')[0] ?? 'invalid YAML'}`,
    );
  }
  if (doc.contents === null) return { params: {} };
  if (!isMap(doc.contents)) throw new FixPolicyError(`${origin}: expected a mapping.`);
  const data = doc.toJS() as Record<string, unknown>;
  for (const key of Object.keys(data)) {
    if (key !== 'params') throw new FixPolicyError(`${origin}: unknown key "${key}".`);
  }
  const params = data.params ?? {};
  if (params === null || typeof params !== 'object' || Array.isArray(params)) {
    throw new FixPolicyError(`${origin}: "params" must be a mapping.`);
  }
  for (const [name, value] of Object.entries(params)) {
    if (value === null || value === undefined) {
      throw new FixPolicyError(`${origin}: parameter "${name}" has no value.`);
    }
  }
  return { params: params as Record<string, unknown> };
}
