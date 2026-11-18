import type { KindStorage, StoredKindSet } from '@k8s-manifestlens/core';

const DB_NAME = 'manifestlens';
const STORE = 'kinds';

/** Imported kinds kept in IndexedDB, which holds CRD bundles of several MB that localStorage cannot. */
export class IndexedDbKindStorage implements KindStorage {
  private db: Promise<IDBDatabase> | undefined;

  constructor(private readonly factory: IDBFactory = indexedDB) {}

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = this.factory.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Could not open local storage.'));
    });
    return this.db;
  }

  private async run<T>(
    mode: IDBTransactionMode,
    op: (s: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = op(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Local storage failed.'));
    });
  }

  list(): Promise<StoredKindSet[]> {
    return this.run('readonly', (s) => s.getAll() as IDBRequest<StoredKindSet[]>);
  }
  async put(set: StoredKindSet): Promise<void> {
    await this.run('readwrite', (s) => s.put(set));
  }
  async remove(id: string): Promise<void> {
    await this.run('readwrite', (s) => s.delete(id));
  }
}
