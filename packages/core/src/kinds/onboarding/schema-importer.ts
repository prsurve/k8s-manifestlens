import { parse } from 'yaml';
import { RuleError } from '../../rules/load.js';
import { crdRule } from '../../rules/crd.js';
import type { CrdSchema, Rule } from '../../rules/types.js';
import { previewRules } from './crd-importer.js';
import type { KindPreview } from './crd-importer.js';

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_DEPTH = 40;
/** Most nodes one schema may grow to once its references are inlined, so a fan-out cannot exhaust memory. */
const MAX_NODES = 200_000;
const MAX_NESTING = 2000;

export interface SchemaIdentity {
  group: string;
  version: string;
  kind: string;
  scope?: 'Namespaced' | 'Cluster';
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Import an OpenAPI schema (JSON or YAML). Either a Kubernetes OpenAPI document, where each schema
 * carries `x-kubernetes-group-version-kind`, or a single schema plus the `identity` it describes.
 * Local `$ref`s are inlined because the validator does not follow references; a reference that
 * cannot be inlined (a cycle, or too deep) is left in place and reported as unsupported.
 */
export function importOpenApi(
  text: string,
  identity?: SchemaIdentity,
  origin = 'openapi',
): { rules: Rule[]; previews: KindPreview[] } {
  if (text.length > MAX_BYTES) throw new RuleError(`${origin}: the schema text is too large.`);
  let doc: unknown;
  try {
    doc = parse(text);
  } catch (e) {
    throw new RuleError(
      `${origin}: ${(e as Error).message.split('\n')[0] ?? 'invalid YAML or JSON'}`,
    );
  }
  if (!isRecord(doc)) throw new RuleError(`${origin}: expected an OpenAPI schema object.`);

  const components =
    isRecord(doc.components) && isRecord(doc.components.schemas)
      ? doc.components.schemas
      : isRecord(doc.definitions)
        ? doc.definitions
        : undefined;
  const pool = components ?? {};
  const rules: Rule[] = [];

  for (const raw of Object.values(pool)) {
    if (!isRecord(raw)) continue;
    const gvks = raw['x-kubernetes-group-version-kind'];
    if (!Array.isArray(gvks)) continue;
    for (const g of gvks) {
      if (!isRecord(g) || typeof g.kind !== 'string' || typeof g.version !== 'string') continue;
      const group = typeof g.group === 'string' ? g.group : '';
      rules.push(build({ group, version: g.version, kind: g.kind }, raw, pool, origin));
    }
  }

  if (rules.length === 0) {
    if (identity === undefined) {
      throw new RuleError(
        `${origin}: no schema declares x-kubernetes-group-version-kind, so say which kind this describes (group, version and kind).`,
      );
    }
    rules.push(build(identity, doc, pool, origin));
  }
  return { rules, previews: previewRules(rules) };
}

function build(
  id: SchemaIdentity,
  schema: Record<string, unknown>,
  pool: Record<string, unknown>,
  origin: string,
): Rule {
  const rule = crdRule(
    {
      ...id,
      schema: inline(schema, pool, [], 0, { nodes: 0 }, origin) as CrdSchema,
      source: 'openapi',
    },
    origin,
  );
  return rule;
}

function inline(
  node: unknown,
  pool: Record<string, unknown>,
  stack: string[],
  depth: number,
  budget: { nodes: number },
  origin: string,
): unknown {
  if (++budget.nodes > MAX_NODES) {
    throw new RuleError(
      `${origin}: the schema is too large once its references are resolved (more than ${MAX_NODES} nodes).`,
    );
  }
  if (depth > MAX_NESTING) {
    throw new RuleError(`${origin}: the schema is nested too deeply.`);
  }
  if (Array.isArray(node)) {
    return node.map((n) => inline(n, pool, stack, depth + 1, budget, origin));
  }
  if (!isRecord(node)) return node;
  const ref = node.$ref;
  if (typeof ref === 'string') {
    const name = ref.replace(/^#\/(?:components\/schemas|definitions)\//, '');
    const target = pool[name];
    // Unresolvable, cyclic or too deep: keep the $ref so the preview reports it as unchecked.
    if (!isRecord(target) || stack.includes(name) || depth > MAX_DEPTH || ref === name) return node;
    return inline(target, pool, [...stack, name], depth + 1, budget, origin);
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    out[k] = inline(v, pool, stack, depth + 1, budget, origin);
  }
  return out;
}
