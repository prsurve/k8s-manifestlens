import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseManifest } from '../src/index.js';

const fixture = readFileSync(new URL('../../../examples/web.yaml', import.meta.url), 'utf8');

describe('parseManifest', () => {
  it('splits a multi-document file and reads kind, apiVersion and name', () => {
    const docs = parseManifest(fixture);
    expect(docs.map((d) => [d.kind, d.apiVersion, d.name])).toEqual([
      ['Deployment', 'apps/v1', 'web'],
      ['Service', 'v1', 'web'],
    ]);
    expect(docs.map((d) => d.startLine)).toEqual([1, 26]);
  });

  it('keeps 1-based line numbers across documents', () => {
    const [deployment, service] = parseManifest(fixture);
    const image = deployment?.fields.find((f) => f.key === 'image');
    expect(image).toMatchObject({
      path: 'spec.template.spec.containers[0].image',
      pattern: 'spec.template.spec.containers[].image',
      line: 19,
      column: 11,
      value: 'nginx:1.27',
      type: 'scalar',
    });
    expect(service?.fields.find((f) => f.key === 'type')?.line).toBe(31);
  });

  it('records the type and depth of containers', () => {
    const [deployment] = parseManifest(fixture);
    const byPath = (p: string) => deployment?.fields.find((f) => f.path === p);
    expect(byPath('spec')).toMatchObject({ type: 'map', depth: 0 });
    expect(byPath('spec.template.spec.containers')).toMatchObject({ type: 'list', depth: 3 });
    expect(byPath('spec.template.spec.containers[0].name')?.depth).toBe(4);
  });

  it('indexes list items separately but shares one pattern', () => {
    const [doc] = parseManifest('kind: Pod\nspec:\n  containers:\n    - name: a\n    - name: b\n');
    const names = doc?.fields.filter((f) => f.key === 'name');
    expect(names?.map((f) => f.path)).toEqual([
      'spec.containers[0].name',
      'spec.containers[1].name',
    ]);
    expect(new Set(names?.map((f) => f.pattern))).toEqual(new Set(['spec.containers[].name']));
  });

  it('ignores empty documents from stray separators', () => {
    const docs = parseManifest('---\nkind: Pod\n---\n---\nkind: Service\n---\n');
    expect(docs.map((d) => d.kind)).toEqual(['Pod', 'Service']);
    expect(docs.map((d) => d.index)).toEqual([0, 1]);
  });

  it('reports YAML syntax errors with a line number', () => {
    const [doc] = parseManifest('kind: Pod\nspec:\n  containers: [a, b\n');
    expect(doc?.issues.length).toBeGreaterThan(0);
    expect(doc?.issues[0]?.line).toBeGreaterThanOrEqual(3);
  });

  it('flags a document whose top level is not a mapping', () => {
    const [doc] = parseManifest('- just\n- a list\n');
    expect(doc?.issues[0]?.message).toMatch(/mapping/);
    expect(doc?.fields).toEqual([]);
  });

  it('returns nothing for an empty file', () => {
    expect(parseManifest('')).toEqual([]);
  });
});
