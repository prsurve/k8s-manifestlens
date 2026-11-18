import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_INVENTORY,
  buildRegistry,
  classifyKind,
  detectConflicts,
  parseCrds,
  resolveKind,
  supportedKinds,
} from '../src/index.js';

const CRD = (group: string, kind: string, version = 'v1') =>
  [
    'apiVersion: apiextensions.k8s.io/v1',
    'kind: CustomResourceDefinition',
    'spec:',
    `  group: ${group}`,
    `  names: { kind: ${kind} }`,
    '  versions:',
    `    - name: ${version}`,
    '      schema: { openAPIV3Schema: { type: object } }',
  ].join('\n');

describe('classifyKind', () => {
  it('marks the 25 bundled kinds supported at their own apiVersion', () => {
    for (const kind of supportedKinds()) {
      const b = BUILT_IN_INVENTORY.find((x) => x.kind === kind);
      if (b === undefined) throw new Error(`${kind} is missing from the inventory`);
      const apiVersion = b.group ? `${b.group}/${b.version}` : b.version;
      expect(classifyKind(kind, apiVersion).category, kind).toBe('supported');
    }
  });

  it('keeps hand-written precedence in the registry', () => {
    const source = (k: string) => buildRegistry().find((e) => e.kind === k)?.source;
    expect(source('Pod')).toBe('handwritten');
    expect(source('Deployment')).toBe('handwritten');
    expect(source('Ingress')).toBe('generated');
  });

  it('flags a built-in the dataset does not cover', () => {
    expect(classifyKind('Node', 'v1').category).toBe('missing-builtin');
    expect(classifyKind('Lease', 'coordination.k8s.io/v1').category).toBe('missing-builtin');
  });

  it('does not call every unknown kind a CRD', () => {
    expect(classifyKind('Certificate', 'cert-manager.io/v1').category).toBe('custom');
    expect(classifyKind('Foo', 'apps/v1').category).toBe('unknown');
    expect(classifyKind('Podd', 'v1').category).toBe('unknown');
  });

  it('treats a built-in kind name in a custom group as custom', () => {
    expect(classifyKind('Pod', 'example.com/v1').category).toBe('custom');
  });

  it('reports an unrecognized apiVersion for a known kind', () => {
    const c = classifyKind('Deployment', 'apps/v1beta1');
    expect(c.category).toBe('supported');
    expect(c.apiVersion).toBe('unrecognized');
  });

  it('reports malformed identities', () => {
    expect(classifyKind(undefined, 'v1').category).toBe('malformed');
    expect(classifyKind('Pod', undefined).category).toBe('malformed');
    expect(classifyKind('Pod', 'apps//v1').category).toBe('malformed');
    expect(classifyKind('my kind', 'v1').category).toBe('malformed');
  });

  it('supports an imported CRD and recognizes its versions', () => {
    const rules = parseCrds(CRD('cert-manager.io', 'Certificate'));
    const c = classifyKind('Certificate', 'cert-manager.io/v1', rules);
    expect(c.category).toBe('supported');
    expect(c.entry?.source).toBe('imported-crd');
    expect(classifyKind('Certificate', 'cert-manager.io/v2', rules).apiVersion).toBe(
      'unrecognized',
    );
  });
});

describe('registry conflicts', () => {
  it('never lets an imported CRD override a built-in', () => {
    const rules = parseCrds(CRD('networking.k8s.io', 'Ingress'));
    const entries = buildRegistry(rules);
    const conflicts = detectConflicts(entries);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.winner.source).toBe('generated');
    expect(conflicts[0]?.shadowed[0]?.source).toBe('imported-crd');
    expect(resolveKind(entries, 'networking.k8s.io', 'v1', 'Ingress')?.source).toBe('generated');
  });

  it('reports no conflict for distinct kinds', () => {
    expect(detectConflicts(buildRegistry(parseCrds(CRD('a.io', 'Foo'))))).toEqual([]);
  });
});
