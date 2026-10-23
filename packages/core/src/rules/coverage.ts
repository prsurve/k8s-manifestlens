import { hasDocsFor } from '../fields/index.js';
import { POD_SPEC_PATH } from '../fields/locate.js';
import type { Coverage } from './types.js';
import type { Rule } from './types.js';

/** True for an apiVersion whose group is not a Kubernetes one, e.g. `cert-manager.io/v1`. */
function isCustomResource(apiVersion: string | undefined): boolean {
  const group = apiVersion?.includes('/') ? apiVersion.slice(0, apiVersion.indexOf('/')) : '';
  // Built-in groups are `k8s.io` or `<name>.k8s.io`; any other dotted group is a custom resource.
  return group.includes('.') && !/^([a-z0-9-]+\.)*k8s\.io$/.test(group);
}

/** Kinds that at least one rule looks at: the ones named by a rule, and everything with a Pod spec. */
export function checkedKinds(rules: Rule[]): string[] {
  const kinds = new Set(Object.keys(POD_SPEC_PATH));
  for (const rule of rules) for (const kind of rule.kinds) if (kind !== '*') kinds.add(kind);
  return [...kinds].sort();
}

/**
 * Whether ManifestLens actually looked at a document. A kind with no rules gets no findings, which
 * reads as "all clear" when the truth is "nobody checked", so say so.
 */
export function kindCoverage(
  kind: string | undefined,
  apiVersion: string | undefined,
  rules: Rule[],
): Coverage {
  if (kind === undefined) {
    return {
      level: 'unchecked',
      message:
        'This document has no "kind", so ManifestLens cannot tell what it is and checked nothing.',
    };
  }
  if (Object.hasOwn(POD_SPEC_PATH, kind) || rules.some((r) => r.kinds.includes(kind))) {
    return { level: 'checked' };
  }
  const caveat = '"No findings" here does not mean it is safe.';
  if (hasDocsFor(kind)) {
    return {
      level: 'explain-only',
      message: `ManifestLens explains ${kind} fields but has no rules that check it. ${caveat}`,
    };
  }
  const what = isCustomResource(apiVersion)
    ? `${kind} (${apiVersion}) is a custom resource`
    : `ManifestLens does not know the kind ${kind}`;
  return {
    level: 'unchecked',
    message: `${what}, so it was not checked: only generic checks, such as removed apiVersions, ran on it. ${caveat}`,
  };
}
