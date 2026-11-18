import { describe, expect, it } from 'vitest';
import {
  KindStore,
  MemoryKindStorage,
  RuleError,
  analyzeSchema,
  classifyKind,
  explainManifest,
  importCrds,
  importOpenApi,
} from '../src/index.js';
import { isRiskyPattern } from '../src/rules/crd.js';

/** Hostile input: schemas, registries and manifests can come from a pull request or a shared file. */
const crdWith = (props: string): string => `apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
spec:
  group: w.io
  names: { kind: W }
  versions:
    - name: v1
      schema:
        openAPIV3Schema:
          type: object
          properties:
            spec:
              type: object
              properties:
${props}
`;
const timed = <T>(f: () => T): { value: T; ms: number } => {
  const start = Date.now();
  return { value: f(), ms: Date.now() - start };
};

describe('pattern safety', () => {
  it('recognises patterns that can take exponential time, and leaves ordinary ones alone', () => {
    for (const bad of [
      '^(a+)+$',
      '^(a*)*$',
      '^(\\w+\\s?)+$',
      '(.*)*x',
      '^([a-z]+)*$',
      '(?:a+){2,}',
    ]) {
      expect(isRiskyPattern(bad), bad).toBe(true);
    }
    for (const ok of [
      '^[a-z]([-a-z0-9]*[a-z0-9])?$',
      '^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$',
      '^(foo|bar)+$',
      '^\\d+(\\.\\d+)?$',
      '^[0-9]+(Ki|Mi|Gi)?$',
      '^(\\[a+\\])+$',
    ]) {
      expect(isRiskyPattern(ok), ok).toBe(false);
    }
  });

  it('does not evaluate a catastrophic pattern, and says so instead of claiming it passed', () => {
    const { rules } = importCrds(
      crdWith("                n: { type: string, pattern: '^(a+)+$' }"),
    );
    const { value, ms } = timed(() =>
      explainManifest(`apiVersion: w.io/v1\nkind: W\nspec:\n  n: "${'a'.repeat(60)}!"\n`, rules),
    );
    expect(ms).toBeLessThan(1000);
    expect(value.documents[0]?.issues.map((i) => i.message).join(' ')).toMatch(/not checked/);
  });

  it('still checks the standard DNS pattern', () => {
    const dns = '^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\\\\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$';
    const { rules } = importCrds(
      crdWith(`                host: { type: string, pattern: '${dns}' }`),
    );
    const issues = explainManifest('apiVersion: w.io/v1\nkind: W\nspec:\n  host: Bad_Name\n', rules)
      .documents[0]?.issues;
    expect(issues?.map((i) => i.message).join(' ')).toMatch(/does not match the pattern/);
  });

  it('lists the unsafe pattern as not checked in the preview', () => {
    const { previews } = importCrds(
      crdWith("                n: { type: string, pattern: '^(a+)+$' }"),
    );
    const caps = previews[0]?.versions[0]?.capabilities;
    expect(caps?.unsupported.map((u) => u.keyword)).toContain('pattern (unsafe, skipped)');
    expect(caps?.supported).not.toContain('pattern');
  });
});

describe('schema size limits', () => {
  it('refuses a $ref fan-out instead of expanding it', () => {
    const schemas: Record<string, unknown> = {};
    const next = (i: number) => ({ $ref: `#/components/schemas/S${i + 1}` });
    for (let i = 0; i < 12; i++) {
      schemas[`S${i}`] = {
        type: 'object',
        properties: Object.fromEntries(Array.from({ length: 10 }, (_, k) => [`p${k}`, next(i)])),
      };
    }
    schemas.S12 = { type: 'string' };
    schemas.W = {
      'x-kubernetes-group-version-kind': [{ group: 'w.io', version: 'v1', kind: 'W' }],
      properties: { s: { $ref: '#/components/schemas/S0' } },
    };
    const { ms } = timed(() => {
      expect(() => importOpenApi(JSON.stringify({ components: { schemas } }))).toThrow(
        /too large once its references are resolved/,
      );
    });
    expect(ms).toBeLessThan(5000);
  });

  it('refuses a schema nested absurdly deep, as an error and not a crash', () => {
    const deep = (n: number): string =>
      `{"type":"object","properties":{"a":`.repeat(n) + '{"type":"string"}' + '}}'.repeat(n);
    expect(() => importOpenApi(deep(3000), { group: 'w.io', version: 'v1', kind: 'W' })).toThrow(
      RuleError,
    );
  });

  it('keeps the analysis of a deep, wide schema bounded', () => {
    let node: Record<string, unknown> = { type: 'string' };
    for (let i = 0; i < 500; i++) node = { type: 'object', properties: { a: node } };
    const caps = analyzeSchema(node);
    expect(caps.fields.length).toBeLessThanOrEqual(500);
  });
});

describe('hostile identities and keys', () => {
  it('classifies absurd identities quickly and as malformed', () => {
    const { value, ms } = timed(() => [
      classifyKind('Pod', `${'a'.repeat(200_000)}/v1`).category,
      classifyKind('K'.repeat(200_000), 'v1').category,
      classifyKind('Pod', 'v1\nkind: Evil').category,
      classifyKind('Pod\u0000', 'v1').category,
    ]);
    expect(value).toEqual(['malformed', 'malformed', 'malformed', 'malformed']);
    expect(ms).toBeLessThan(500);
  });

  it('does not let manifest keys named like Object members reach the prototype', () => {
    const { rules } = importCrds(crdWith('                x: { type: string }'));
    const out = explainManifest(
      'apiVersion: w.io/v1\nkind: W\nspec:\n  __proto__: {polluted: 1}\n  constructor: 5\n  hasOwnProperty: 1\n',
      rules,
    );
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(out.documents[0]?.issues.map((i) => i.message).join(' ')).toMatch(/__proto__/);
  });
});

describe('untrusted stored data', () => {
  const good = (id: string, importedAt: string) => ({
    id,
    format: 'crd' as const,
    text: crdWith('                x: { type: string }'),
    kinds: [{ group: 'w.io', kind: 'W', versions: ['v1'] }],
    enabled: true,
    importedAt,
  });

  it('skips entries with the wrong shape instead of crashing, whatever the backend returns', async () => {
    const storage = new MemoryKindStorage();
    await storage.put(good('crd:a', '2026-01-01T00:00:00.000Z'));
    await storage.put({ ...good('crd:b', 'x'), importedAt: 5 as never });
    await storage.put({ ...good('crd:c', 'x'), text: undefined as never });
    const store = new KindStore(storage);
    expect((await store.list()).map((s) => s.id)).toEqual(['crd:a']);
    expect((await store.load()).rules).toHaveLength(1);
  });

  it('survives an export file full of tricks', async () => {
    const store = new KindStore(new MemoryKindStorage());
    const bundle = (sets: unknown[]) =>
      JSON.stringify({ format: 'k8s-manifestlens-kinds', version: 1, sets });
    const evil = JSON.parse(
      '{"__proto__":{"polluted":1},"id":"x","format":"crd","text":"kind: Pod","enabled":true}',
    );
    const out = await store.import(bundle([evil, null, 7, 'x', [], { format: 'crd', text: 5 }]));
    expect(out.imported).toEqual([]);
    expect(out.skipped).toHaveLength(6);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    await expect(store.import(bundle(Array.from({ length: 501 }, () => ({}))))).rejects.toThrow(
      /too many/,
    );
  });

  it('never lets an import replace a built-in kind, from a CRD or an OpenAPI schema', async () => {
    const store = new KindStore(new MemoryKindStorage());
    const claim = (group: string, kind: string) =>
      crdWith('                x: { type: string }')
        .replace('w.io', group)
        .replace('kind: W', `kind: ${kind}`);
    for (const [g, k] of [
      ['apps', 'Deployment'],
      ['networking.k8s.io', 'Ingress'],
    ] as const) {
      expect((await store.add('crd', claim(g, k))).set, k).toBeUndefined();
    }
    const core = await store.add(
      'openapi',
      'type: object\nproperties: { spec: { type: object } }',
      {
        identity: { group: '', version: 'v1', kind: 'Pod' },
      },
    );
    expect(core.set).toBeUndefined();
    expect(core.registration.rejected[0]?.reason).toMatch(/built-in/);
    expect(await store.list()).toEqual([]);
  });
});
