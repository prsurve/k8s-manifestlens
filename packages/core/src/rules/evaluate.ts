import type { Condition } from './types.js';

export interface Match {
  /** Concrete path relative to the root it was resolved from, e.g. `volumes[1].hostPath`. */
  path: string;
  value: unknown;
}

/** The data a condition is evaluated against: the rule's scope, plus the enclosing Pod spec. */
export interface EvalContext {
  scope: unknown;
  pod: unknown;
}

const POD_PREFIX = '$pod.';

/** True when the path starts at the Pod spec instead of at the rule's scope. */
export function isPodPath(path: string): boolean {
  return path.startsWith(POD_PREFIX);
}

/**
 * Resolve a dotted path. A `[]` suffix on a key walks every item of a list: `volumes[].hostPath`.
 * Null and missing values are dropped, so a bare `resources:` counts as absent.
 */
export function resolve(root: unknown, path: string): Match[] {
  const rel = isPodPath(path) ? path.slice(POD_PREFIX.length) : path;
  let current: Match[] = [{ path: '', value: root }];
  for (const segment of rel.split('.')) {
    const each = segment.endsWith('[]');
    const key = each ? segment.slice(0, -2) : segment;
    const next: Match[] = [];
    for (const { path: prefix, value } of current) {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) continue;
      const child = (value as Record<string, unknown>)[key];
      const childPath = prefix === '' ? key : `${prefix}.${key}`;
      if (child === null || child === undefined) continue;
      if (!each) {
        next.push({ path: childPath, value: child });
      } else if (Array.isArray(child)) {
        child.forEach((item: unknown, i) => {
          if (item !== null && item !== undefined)
            next.push({ path: `${childPath}[${i}]`, value: item });
        });
      }
    }
    current = next;
    if (current.length === 0) break;
  }
  return current;
}

function matchesFor(ctx: EvalContext, path: string): Match[] {
  return resolve(isPodPath(path) ? ctx.pod : ctx.scope, path);
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Evaluate a condition. For operators over several matches, one satisfying match is enough. */
export function evaluate(cond: Condition, ctx: EvalContext): boolean {
  switch (cond.op) {
    case 'missing':
      return matchesFor(ctx, cond.path).length === 0;
    case 'present':
      return matchesFor(ctx, cond.path).length > 0;
    case 'equals':
      return matchesFor(ctx, cond.path).some((m) => same(m.value, cond.value));
    case 'in':
      return matchesFor(ctx, cond.path).some((m) => cond.values.some((v) => same(m.value, v)));
    case 'contains':
      return matchesFor(ctx, cond.path).some(
        (m) => Array.isArray(m.value) && m.value.some((v: unknown) => same(v, cond.value)),
      );
    case 'matches':
      return matchesFor(ctx, cond.path).some(
        (m) =>
          (typeof m.value === 'string' ||
            typeof m.value === 'number' ||
            typeof m.value === 'boolean') &&
          cond.pattern.test(String(m.value)),
      );
    case 'all':
      return cond.conditions.every((c) => evaluate(c, ctx));
    case 'any':
      return cond.conditions.some((c) => evaluate(c, ctx));
    case 'not':
      return !evaluate(cond.condition, ctx);
    case 'some':
      return matchesFor(ctx, cond.path).some(
        (m) =>
          Array.isArray(m.value) &&
          m.value.some(
            (item: unknown) =>
              item !== null &&
              typeof item === 'object' &&
              !Array.isArray(item) &&
              evaluate(cond.condition, { scope: item, pod: ctx.pod }),
          ),
      );
  }
}
