import { describe, expect, it } from 'vitest';
import {
  analyzeSchema,
  explainManifest,
  importCrds,
  importOpenApi,
  parseCrds,
  registerKinds,
  RuleError,
} from '../src/index.js';

const CRD = (group: string, kind: string, schema: string, scope = 'Namespaced') =>
  `apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
spec:
  group: ${group}
  scope: ${scope}
  names: { kind: ${kind} }
  versions:
    - name: v1
      schema:
        openAPIV3Schema:
${schema
  .split('\n')
  .map((l) => `          ${l}`)
  .join('\n')}
`;

const WIDGET = `type: object
required: [spec]
properties:
  spec:
    type: object
    required: [size]
    properties:
      size: { type: integer, minimum: 1, maximum: 5 }
      mode: { type: string, enum: [fast, slow] }
      name: { type: string, pattern: '^[a-z]+$', format: hostname }
      tags: { type: array, minItems: 1, items: { type: string } }
    oneOf:
      - required: [mode]`;

describe('analyzeSchema', () => {
  const caps = analyzeSchema(parseCrds(CRD('w.io', 'Widget', WIDGET))[0]?.crd?.schema ?? {});

  it('lists fields and required fields', () => {
    expect(caps.level).toBe('schema-backed');
    expect(caps.fields.map((f) => f.path)).toContain('spec.size');
    expect(caps.requiredFields).toEqual(expect.arrayContaining(['spec', 'spec.size']));
  });

  it('reports supported constraints', () => {
    expect(caps.supported).toEqual(
      expect.arrayContaining(['required', 'type', 'enum', 'pattern', 'minimum', 'maximum']),
    );
  });

  it('reports unsupported constraints instead of claiming them', () => {
    const kw = caps.unsupported.map((u) => u.keyword);
    expect(kw).toEqual(expect.arrayContaining(['oneOf', 'format', 'minItems']));
    expect(caps.supported).not.toContain('format');
  });

  it('is basic when the schema names no fields', () => {
    expect(analyzeSchema({ type: 'object' }).level).toBe('basic');
  });
});

describe('importCrds', () => {
  it('previews kind, group, scope and versions', () => {
    const { previews } = importCrds(CRD('w.io', 'Widget', WIDGET, 'Cluster'));
    expect(previews).toHaveLength(1);
    expect(previews[0]).toMatchObject({ group: 'w.io', kind: 'Widget', scope: 'Cluster' });
    expect(previews[0]?.versions.map((v) => v.version)).toEqual(['v1']);
  });
});

describe('importOpenApi', () => {
  const doc = JSON.stringify({
    components: {
      schemas: {
        Widget: {
          type: 'object',
          'x-kubernetes-group-version-kind': [{ group: 'w.io', version: 'v1', kind: 'Widget' }],
          properties: { spec: { $ref: '#/components/schemas/WidgetSpec' } },
        },
        WidgetSpec: {
          type: 'object',
          required: ['size'],
          properties: {
            size: { type: 'integer' },
            self: { $ref: '#/components/schemas/WidgetSpec' },
          },
        },
      },
    },
  });

  it('inlines refs, validates, and reports the cycle it could not inline', () => {
    const { rules, previews } = importOpenApi(doc);
    expect(rules[0]?.crd?.source).toBe('openapi');
    expect(previews[0]?.versions[0]?.capabilities.requiredFields).toContain('spec.size');
    expect(previews[0]?.versions[0]?.capabilities.unsupported.map((u) => u.keyword)).toContain(
      '$ref',
    );
  });

  it('accepts a single schema with an explicit identity', () => {
    const { rules } = importOpenApi('type: object\nproperties: { a: { type: string } }', {
      group: 'x.io',
      version: 'v1',
      kind: 'Thing',
    });
    expect(rules[0]?.crd).toMatchObject({ kind: 'Thing', source: 'openapi' });
  });

  it('asks for an identity when the schema has none', () => {
    expect(() => importOpenApi('type: object')).toThrow(RuleError);
    expect(() => importOpenApi('[1, 2')).toThrow(RuleError);
  });
});

describe('registerKinds and re-analysis', () => {
  const manifest = 'apiVersion: w.io/v1\nkind: Widget\nspec:\n  size: 9\n  colour: red\n';

  it('registers a CRD and the original manifest is then explained and validated', () => {
    expect(explainManifest(manifest).documents[0]?.unsupportedKind).toBe(true);
    const { rules } = importCrds(
      CRD('w.io', 'Widget', WIDGET.replace(/ {4}oneOf:\n {6}- required: \[mode\]/, '')),
    );
    const result = registerKinds([], rules);
    expect(result.added).toEqual(['w.io/v1/Widget']);
    const doc = explainManifest(manifest, result.rules).documents[0];
    expect(doc?.unsupportedKind).toBe(false);
    expect(doc?.issues.map((i) => i.message).join(' ')).toMatch(/above the maximum|colour/);
  });

  it('rejects an import that claims a built-in kind', () => {
    const { rules } = importCrds(CRD('networking.k8s.io', 'Ingress', 'type: object'));
    const result = registerKinds([], rules);
    expect(result.rules).toHaveLength(0);
    expect(result.rejected[0]?.reason).toMatch(/built-in/);
  });

  it('updates a repeated import and lets a CRD beat an OpenAPI import', () => {
    const crd = importCrds(CRD('w.io', 'Widget', WIDGET)).rules;
    const api = importOpenApi('type: object', {
      group: 'w.io',
      version: 'v1',
      kind: 'Widget',
    }).rules;
    const first = registerKinds([], crd);
    expect(registerKinds(first.rules, crd).updated).toEqual(['w.io/v1/Widget']);
    const lower = registerKinds(first.rules, api);
    expect(lower.rejected).toHaveLength(1);
    const upgraded = registerKinds(registerKinds([], api).rules, crd);
    expect(upgraded.rules[0]?.crd?.source).toBe('crd');
  });
});
