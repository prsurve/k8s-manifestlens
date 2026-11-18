import { handWrittenKinds } from '../../fields/index.js';
import { schemaKindVersions, schemaVersion } from '../../fields/schema.js';
import type { Rule } from '../../rules/types.js';
import { splitApiVersion } from '../inventory/built-in-inventory.js';

export type KindSource =
  'handwritten' | 'generated' | 'imported-crd' | 'imported-openapi' | 'ecosystem-pack';

/** Lowest number wins: a built-in definition always beats an imported one. */
export const SOURCE_PRECEDENCE: readonly KindSource[] = [
  'handwritten',
  'generated',
  'imported-crd',
  'imported-openapi',
  'ecosystem-pack',
];

export interface KindEntry {
  /** API group; empty for the core group. */
  group: string;
  kind: string;
  version: string;
  source: KindSource;
  /** Kubernetes release (built-in) or origin of the schema (imported). */
  datasetVersion: string;
}

export interface KindConflict {
  group: string;
  kind: string;
  version: string;
  /** The definition that is used. */
  winner: KindEntry;
  /** Definitions that lost; they never override the winner. */
  shadowed: KindEntry[];
}

/** Every kind k8s-manifestlens can explain: the bundled built-ins plus CRDs compiled into `rules`. */
export function buildRegistry(rules: Rule[] = []): KindEntry[] {
  const hand = new Set(handWrittenKinds());
  const entries: KindEntry[] = Object.entries(schemaKindVersions()).map(([kind, gv]) => ({
    ...splitApiVersion(gv),
    kind,
    source: hand.has(kind) ? 'handwritten' : 'generated',
    datasetVersion: schemaVersion,
  }));
  for (const rule of rules) {
    if (rule.crd === undefined) continue;
    const { group, version, kind, source } = rule.crd;
    entries.push({
      group,
      version,
      kind,
      source: source === 'openapi' ? 'imported-openapi' : 'imported-crd',
      datasetVersion: 'imported',
    });
  }
  return entries;
}

const rank = (e: KindEntry): number => SOURCE_PRECEDENCE.indexOf(e.source);

/**
 * Definitions that claim the same group, kind and version. The highest-precedence one wins; the
 * rest are reported so a CRD can never quietly replace a built-in kind.
 */
export function detectConflicts(entries: KindEntry[]): KindConflict[] {
  const byId = new Map<string, KindEntry[]>();
  for (const e of entries) {
    const id = `${e.group}/${e.version}/${e.kind}`;
    byId.set(id, [...(byId.get(id) ?? []), e]);
  }
  const conflicts: KindConflict[] = [];
  for (const list of byId.values()) {
    if (list.length < 2) continue;
    const [winner, ...shadowed] = [...list].sort((a, b) => rank(a) - rank(b)) as [
      KindEntry,
      ...KindEntry[],
    ];
    conflicts.push({
      group: winner.group,
      kind: winner.kind,
      version: winner.version,
      winner,
      shadowed,
    });
  }
  return conflicts;
}

/** The definition to use for a resource, or undefined when none is registered. */
export function resolveKind(
  entries: KindEntry[],
  group: string,
  version: string,
  kind: string,
): KindEntry | undefined {
  return entries
    .filter((e) => e.group === group && e.version === version && e.kind === kind)
    .sort((a, b) => rank(a) - rank(b))[0];
}
