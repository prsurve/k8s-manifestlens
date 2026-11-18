import { isRiskyPattern } from '../../rules/crd.js';
import type { CrdSchema } from '../../rules/types.js';

/** Constraints that `validateAgainst` really checks. Keep in step with rules/crd.ts. */
export const SUPPORTED_CONSTRAINTS = [
  'required',
  'type',
  'enum',
  'pattern',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'unknown-fields',
] as const;
export type SupportedConstraint = (typeof SUPPORTED_CONSTRAINTS)[number];

/** Schema keywords k8s-manifestlens sees but does not evaluate. A value is never called valid because of them. */
const UNSUPPORTED_KEYWORDS = [
  'oneOf',
  'anyOf',
  'allOf',
  'not',
  'x-kubernetes-validations',
  'format',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minProperties',
  'maxProperties',
  'multipleOf',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'x-kubernetes-preserve-unknown-fields',
  '$ref',
] as const;

export interface UnsupportedFeature {
  keyword: string;
  /** How many places in the schema use it. */
  count: number;
  /** Where it first appears, e.g. `spec.replicas`. */
  firstPath: string;
}

export interface SchemaField {
  path: string;
  type?: string;
  required: boolean;
  description?: string;
}

export interface SchemaCapabilities {
  /** `basic`: the schema names no fields, so only the kind is recognised. `schema-backed`: fields are validated. */
  level: 'basic' | 'schema-backed';
  fields: SchemaField[];
  /** True when the field list was cut at `MAX_FIELDS`. */
  fieldsTruncated: boolean;
  requiredFields: string[];
  /** Constraints present in the schema that are checked. */
  supported: SupportedConstraint[];
  /** Constraints present in the schema that are NOT checked. */
  unsupported: UnsupportedFeature[];
}

const MAX_FIELDS = 500;
const MAX_DEPTH = 40;
const ENVELOPE = new Set(['apiVersion', 'kind', 'metadata']);

/** Report what a schema can and cannot validate, before it is registered. */
export function analyzeSchema(schema: CrdSchema): SchemaCapabilities {
  const fields: SchemaField[] = [];
  const supported = new Set<SupportedConstraint>();
  const unsupported = new Map<string, UnsupportedFeature>();
  let truncated = false;

  const walk = (node: CrdSchema, path: string, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    const rec = node as Record<string, unknown>;
    for (const kw of UNSUPPORTED_KEYWORDS) {
      // preserve-unknown-fields: false is a no-op, only `true` switches checking off.
      if (
        rec[kw] === undefined ||
        (kw === 'x-kubernetes-preserve-unknown-fields' && rec[kw] !== true)
      )
        continue;
      const seen = unsupported.get(kw);
      if (seen) seen.count++;
      else unsupported.set(kw, { keyword: kw, count: 1, firstPath: path || '(root)' });
    }
    if (typeof node.pattern === 'string' && isRiskyPattern(node.pattern)) {
      const seen = unsupported.get('pattern (unsafe, skipped)');
      if (seen) seen.count++;
      else
        unsupported.set('pattern (unsafe, skipped)', {
          keyword: 'pattern (unsafe, skipped)',
          count: 1,
          firstPath: path || '(root)',
        });
    }
    if (node.type !== undefined) supported.add('type');
    for (const c of ['enum', 'pattern', 'minimum', 'maximum', 'minLength', 'maxLength'] as const) {
      if (node[c] !== undefined && !(c === 'pattern' && isRiskyPattern(String(node.pattern)))) {
        supported.add(c);
      }
    }
    if (node.properties && node['x-kubernetes-preserve-unknown-fields'] !== true) {
      supported.add('unknown-fields');
    }
    const required = new Set(node.required ?? []);
    if (required.size > 0) supported.add('required');
    for (const [name, child] of Object.entries(node.properties ?? {})) {
      if (depth === 0 && ENVELOPE.has(name)) continue;
      const p = path ? `${path}.${name}` : name;
      if (fields.length < MAX_FIELDS) {
        fields.push({
          path: p,
          ...(child.type !== undefined ? { type: child.type } : {}),
          required: required.has(name),
          ...(child.description !== undefined ? { description: child.description } : {}),
        });
      } else truncated = true;
      walk(child, p, depth + 1);
    }
    if (node.items) walk(node.items, `${path}[]`, depth + 1);
    if (typeof node.additionalProperties === 'object') {
      walk(node.additionalProperties, `${path}.*`, depth + 1);
    }
  };
  walk(schema, '', 0);

  return {
    level: fields.length > 0 ? 'schema-backed' : 'basic',
    fields,
    fieldsTruncated: truncated,
    requiredFields: fields.filter((f) => f.required).map((f) => f.path),
    supported: SUPPORTED_CONSTRAINTS.filter((c) => supported.has(c)),
    unsupported: [...unsupported.values()],
  };
}
