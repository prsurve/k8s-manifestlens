import type { Rule } from '../../rules/types.js';
import { SOURCE_PRECEDENCE, buildRegistry } from '../registry/kind-registry.js';
import type { KindSource } from '../registry/kind-registry.js';

export interface RejectedKind {
  group: string;
  kind: string;
  version: string;
  reason: string;
}

export interface RegistrationResult {
  /** The full rule list after registering: use this from now on. */
  rules: Rule[];
  added: string[];
  /** Replaced an earlier import of the same kind and source. */
  updated: string[];
  /** Not registered, with the reason. Built-ins are never overridden. */
  rejected: RejectedKind[];
}

const id = (r: { group: string; version: string; kind: string }): string =>
  `${r.group}/${r.version}/${r.kind}`;
const sourceOf = (r: Rule): KindSource =>
  r.crd?.source === 'openapi' ? 'imported-openapi' : 'imported-crd';
const rank = (s: KindSource): number => SOURCE_PRECEDENCE.indexOf(s);

/**
 * Add imported rules to the ones already registered. An import that claims a built-in kind is
 * rejected; one that repeats an earlier import of the same source replaces it; one that clashes
 * with a different source loses if that source ranks higher.
 */
export function registerKinds(current: Rule[], incoming: Rule[]): RegistrationResult {
  const builtIn = new Set(buildRegistry().map(id));
  let rules = [...current];
  const added: string[] = [];
  const updated: string[] = [];
  const rejected: RejectedKind[] = [];

  for (const rule of incoming) {
    if (rule.crd === undefined) {
      rules.push(rule);
      continue;
    }
    const crd = rule.crd;
    const key = id(crd);
    const reject = (reason: string): void => {
      rejected.push({ group: crd.group, kind: crd.kind, version: crd.version, reason });
    };
    if (builtIn.has(key)) {
      reject(
        'This is a built-in kind, and an imported schema never overrides a built-in definition.',
      );
      continue;
    }
    const existing = rules.find((r) => r.crd !== undefined && id(r.crd) === key);
    if (existing === undefined) {
      rules.push(rule);
      added.push(key);
    } else if (sourceOf(existing) === sourceOf(rule)) {
      rules = rules.map((r) => (r === existing ? rule : r));
      updated.push(key);
    } else if (rank(sourceOf(rule)) < rank(sourceOf(existing))) {
      rules = rules.map((r) => (r === existing ? rule : r));
      updated.push(key);
    } else {
      reject(`A ${sourceOf(existing)} definition already covers this kind and takes precedence.`);
    }
  }
  return { rules, added, updated, rejected };
}
