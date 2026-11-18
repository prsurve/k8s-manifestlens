import { describe, expect, it } from 'vitest';
import { KindStore, MemoryKindStorage, RuleError, explainManifest } from '../src/index.js';

const crd = (group: string, kind: string) => `apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
spec:
  group: ${group}
  names: { kind: ${kind} }
  versions:
    - name: v1
      schema: { openAPIV3Schema: { type: object, properties: { spec: { type: object, properties: { size: { type: integer } } } } } }
`;

describe('KindStore', () => {
  it('saves, reloads from storage and re-analyses a manifest', async () => {
    const storage = new MemoryKindStorage();
    await new KindStore(storage).add('crd', crd('w.io', 'Widget'));
    const { rules } = await new KindStore(storage).load();
    const doc = explainManifest('apiVersion: w.io/v1\nkind: Widget\nspec:\n  size: x\n', rules)
      .documents[0];
    expect(doc?.unsupportedKind).toBe(false);
    expect(doc?.issues.length).toBeGreaterThan(0);
  });

  it('does not save an import that only claims a built-in', async () => {
    const store = new KindStore(new MemoryKindStorage());
    const res = await store.add('crd', crd('networking.k8s.io', 'Ingress'));
    expect(res.set).toBeUndefined();
    expect(res.registration.rejected).toHaveLength(1);
    expect(await store.list()).toEqual([]);
  });

  it('updates in place when the same kinds are imported again', async () => {
    const store = new KindStore(new MemoryKindStorage());
    await store.add('crd', crd('w.io', 'Widget'));
    await store.add('crd', crd('w.io', 'Widget'));
    expect(await store.list()).toHaveLength(1);
  });

  it('disables and removes', async () => {
    const store = new KindStore(new MemoryKindStorage());
    const id = (await store.add('crd', crd('w.io', 'Widget'))).set?.id ?? '';
    await store.setEnabled(id, false);
    expect((await store.load()).rules).toHaveLength(0);
    await store.setEnabled(id, true);
    expect((await store.load()).rules).toHaveLength(1);
    await store.remove(id);
    expect(await store.list()).toHaveLength(0);
  });

  it('exports and imports, keeping the disabled state', async () => {
    const a = new KindStore(new MemoryKindStorage());
    const id = (await a.add('crd', crd('w.io', 'Widget'))).set?.id ?? '';
    await a.add('crd', crd('g.io', 'Gadget'));
    await a.setEnabled(id, false);
    const b = new KindStore(new MemoryKindStorage());
    const out = await b.import(await a.export());
    expect(out.imported).toHaveLength(2);
    expect((await b.load()).rules.map((r) => r.crd?.kind)).toEqual(['Gadget']);
  });

  it('treats an import file as untrusted', async () => {
    const store = new KindStore(new MemoryKindStorage());
    await expect(store.import('nope')).rejects.toThrow(RuleError);
    await expect(store.import('{"format":"other"}')).rejects.toThrow(/not a k8s-manifestlens/);
    const bad = JSON.stringify({
      format: 'k8s-manifestlens-kinds',
      version: 1,
      sets: [{ id: 'x', format: 'crd', text: 'kind: Pod' }, 5],
    });
    const out = await store.import(bad);
    expect(out.imported).toEqual([]);
    expect(out.skipped).toHaveLength(2);
  });

  it('reports a saved set that no longer compiles instead of dropping it', async () => {
    const storage = new MemoryKindStorage();
    await storage.put({
      id: 'crd:broken',
      format: 'crd',
      text: 'kind: Pod',
      kinds: [],
      enabled: true,
      importedAt: new Date().toISOString(),
    });
    const loaded = await new KindStore(storage).load();
    expect(loaded.problems[0]?.id).toBe('crd:broken');
    expect(await storage.list()).toHaveLength(1);
  });
});
