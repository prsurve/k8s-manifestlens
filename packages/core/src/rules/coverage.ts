import { hasDocsFor, supportedKinds } from '../fields/index.js';
import { POD_SPEC_PATH } from '../fields/locate.js';
import type { Coverage } from './types.js';
import type { Rule } from './types.js';

/** True for an apiVersion whose group is not a Kubernetes one, e.g. `cert-manager.io/v1`. */
function isCustomResource(apiVersion: string | undefined): boolean {
  const group = apiVersion?.includes('/') ? apiVersion.slice(0, apiVersion.indexOf('/')) : '';
  // Built-in groups are `k8s.io` or `<name>.k8s.io`; any other dotted group is a custom resource.
  return group.includes('.') && !/^([a-z0-9-]+\.)*k8s\.io$/.test(group);
}

function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1]?.toLowerCase() === b[j - 1]?.toLowerCase() ? 0 : 1;
      row[j] = Math.min((prev[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    prev = row;
  }
  return prev[b.length] ?? 0;
}

/** The known kind closest to a misspelt one, if it is close enough to be a likely typo. */
function suggestKind(kind: string, rules: Rule[]): string | undefined {
  const known = [...new Set([...supportedKinds(), ...checkedKinds(rules)])];
  let best: { kind: string; d: number } | undefined;
  for (const k of known) {
    // `Poddsds` starts with `Pod`: stray extra letters are the commonest typo.
    const prefix = k.length >= 3 && kind.toLowerCase().startsWith(k.toLowerCase());
    const d = prefix ? 1 : distance(kind, k);
    if (!best || d < best.d) best = { kind: k, d };
  }
  return best && best.d <= Math.max(2, Math.floor(kind.length / 3)) ? best.kind : undefined;
}

/** Kinds that at least one rule looks at: the ones named by a rule, and everything with a Pod spec. */
export function checkedKinds(rules: Rule[]): string[] {
  const kinds = new Set(Object.keys(POD_SPEC_PATH));
  for (const rule of rules) for (const kind of rule.kinds) if (kind !== '*') kinds.add(kind);
  return [...kinds].sort();
}

/**
 * Whether k8s-manifestlens actually looked at a document. A kind with no rules gets no findings, which
 * reads as "all clear" when the truth is "nobody checked", so say so.
 */
export function kindCoverage(
  kind: string | undefined,
  apiVersion: string | undefined,
  rules: Rule[],
): Coverage {
  if (kind === undefined) {
    return describe(
      'unchecked',
      'No "kind" field',
      'Without a kind k8s-manifestlens cannot tell what this is, so nothing was checked.',
    );
  }
  if (Object.hasOwn(POD_SPEC_PATH, kind) || rules.some((r) => r.kinds.includes(kind))) {
    return { level: 'checked' };
  }
  if (hasDocsFor(kind)) {
    return describe(
      'explain-only',
      `No rules for ${kind}`,
      `k8s-manifestlens explains ${kind} fields, but no rule checks it.`,
    );
  }
  if (isCustomResource(apiVersion)) {
    return describe(
      'unchecked',
      `Custom resource ${kind} (${apiVersion})`,
      'k8s-manifestlens has no rules for custom resources, so it was not checked.',
    );
  }
  return describe(
    'unchecked',
    `Unknown kind "${kind}"`,
    'k8s-manifestlens has no rules for it, so it was not checked.',
    suggestKind(kind, rules),
  );
}

function describe(
  level: 'explain-only' | 'unchecked',
  headline: string,
  detail: string,
  suggestion?: string,
): Coverage {
  const note = '"No findings" does not mean it is safe.';
  const hint = suggestion ? `Did you mean "${suggestion}"?` : undefined;
  return {
    level,
    headline,
    detail,
    note,
    ...(suggestion !== undefined ? { suggestion } : {}),
    message: [`${headline}.`, detail, hint, note].filter(Boolean).join(' '),
  };
}
