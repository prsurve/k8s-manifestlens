import { describe, expect, it } from 'vitest';
import { KindStore } from '@k8s-manifestlens/core';
import { IndexedDbKindStorage } from '../src/kind-storage.js';

/** Just enough of IndexedDB for the adapter: one keyPath store, with requests that fire asynchronously. */
function fakeFactory(data = new Map<string, unknown>()): IDBFactory {
  const request = <T>(run: () => T): IDBRequest<T> => {
    const req = {} as { result: T; onsuccess?: () => void };
    queueMicrotask(() => {
      req.result = run();
      req.onsuccess?.();
    });
    return req as unknown as IDBRequest<T>;
  };
  const store = {
    getAll: () => request(() => [...data.values()].map((v) => structuredClone(v))),
    put: (v: { id: string }) => request(() => data.set(v.id, structuredClone(v)) && v.id),
    delete: (id: string) => request(() => data.delete(id)),
  };
  const db = { transaction: () => ({ objectStore: () => store }), createObjectStore: () => store };
  return {
    open: () => {
      const req = { result: db } as {
        result: unknown;
        onsuccess?: () => void;
        onupgradeneeded?: () => void;
      };
      queueMicrotask(() => {
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;
}

const CRD = `apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
spec:
  group: w.io
  scope: Namespaced
  names: { kind: Widget }
  versions:
    - name: v1
      schema: { openAPIV3Schema: { type: object, properties: { spec: { type: object } } } }
`;

describe('IndexedDbKindStorage', () => {
  it('keeps imported kinds across sessions (a new store over the same database)', async () => {
    const data = new Map<string, unknown>();
    await new KindStore(new IndexedDbKindStorage(fakeFactory(data))).add('crd', CRD);
    const later = new KindStore(new IndexedDbKindStorage(fakeFactory(data)));
    const loaded = await later.load();
    expect(loaded.rules.map((r) => r.crd?.kind)).toEqual(['Widget']);
  });

  it('removes a set', async () => {
    const store = new KindStore(new IndexedDbKindStorage(fakeFactory()));
    const { set } = await store.add('crd', CRD);
    await store.remove(set?.id ?? '');
    expect(await store.list()).toEqual([]);
  });
});
