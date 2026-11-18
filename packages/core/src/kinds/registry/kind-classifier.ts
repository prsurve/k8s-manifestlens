import { isCustomResource } from '../../rules/coverage.js';
import type { Rule } from '../../rules/types.js';
import { findBuiltIn, splitApiVersion } from '../inventory/built-in-inventory.js';
import { buildRegistry } from './kind-registry.js';
import type { KindEntry } from './kind-registry.js';

export type KindCategory =
  /** Explained by a built-in definition or an imported schema. */
  | 'supported'
  /** A real Kubernetes built-in that the bundled dataset does not cover yet. */
  | 'missing-builtin'
  /** Belongs to a non-Kubernetes API group and has no imported schema. */
  | 'custom'
  /** Not a known built-in and not in a custom group: probably a typo. */
  | 'unknown'
  /** `kind` or `apiVersion` is missing or not a valid identity. */
  | 'malformed';

export interface KindClassification {
  category: KindCategory;
  /** Whether the apiVersion is one k8s-manifestlens knows for this kind; unknown when it knows none. */
  apiVersion: 'recognized' | 'unrecognized' | 'unknown';
  /** The registry entry in use, for `supported`. */
  entry?: KindEntry;
  /** Why the identity is malformed, for `malformed`. */
  reason?: string;
}

const KIND = /^[A-Za-z][A-Za-z0-9]*$/;
const API_VERSION = /^(?:[a-z0-9]([-a-z0-9.]*[a-z0-9])?\/)?v[0-9]+(?:(?:alpha|beta)[0-9]+)?$/;

/**
 * Decide what kind of resource a manifest describes. An unknown kind is not assumed to be a CRD:
 * only a non-Kubernetes API group makes it a custom resource, and a built-in group with an unknown
 * kind is reported as unknown.
 */
export function classifyKind(
  kind: string | undefined,
  apiVersion: string | undefined,
  rules: Rule[] = [],
): KindClassification {
  if (kind === undefined || kind === '') return malformed('The manifest has no "kind".');
  if (!KIND.test(kind)) return malformed(`"${kind}" is not a valid kind name.`);
  if (apiVersion === undefined || apiVersion === '') {
    return malformed('The manifest has no "apiVersion".');
  }
  if (!API_VERSION.test(apiVersion)) return malformed(`"${apiVersion}" is not a valid apiVersion.`);

  const { group, version } = splitApiVersion(apiVersion);
  const sameKind = buildRegistry(rules).filter((e) => e.group === group && e.kind === kind);
  const exact = sameKind
    .filter((e) => e.version === version)
    .sort((a, b) => precedence(a) - precedence(b))[0];
  if (exact !== undefined) return { category: 'supported', apiVersion: 'recognized', entry: exact };

  // The group and kind are covered, but not at this version: still explained, version flagged.
  const other = sameKind[0];
  if (other !== undefined)
    return { category: 'supported', apiVersion: 'unrecognized', entry: other };

  if (isCustomResource(apiVersion)) return { category: 'custom', apiVersion: 'unknown' };

  const builtIns = findBuiltIn(kind);
  const here = builtIns.find((b) => b.group === group);
  if (here !== undefined) {
    return {
      category: 'missing-builtin',
      apiVersion: here.version === version ? 'recognized' : 'unrecognized',
    };
  }
  return { category: 'unknown', apiVersion: 'unknown' };
}

const precedence = (e: KindEntry): number =>
  ['handwritten', 'generated', 'imported-crd', 'imported-openapi', 'ecosystem-pack'].indexOf(
    e.source,
  );

function malformed(reason: string): KindClassification {
  return { category: 'malformed', apiVersion: 'unknown', reason };
}
