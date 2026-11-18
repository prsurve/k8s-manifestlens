import { readFileSync, readdirSync, statSync } from 'node:fs';
import {
  KindStore,
  MemoryKindStorage,
  RuleError,
  importCrds,
  importOpenApi,
  isStoredKindSet,
  loadStoredKinds,
  parseKindBundle,
} from '@k8s-manifestlens/core';
import type { KindStorage, SchemaIdentity, StoredKindSet } from '@k8s-manifestlens/core';

/** The minimum of VS Code's `Memento` that the store needs, so this file never imports `vscode`. */
export interface Memento {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

const KEY = 'k8sManifestlens.kinds';

/** Imported kinds kept in the extension's own storage, so they survive restarts. */
export class MementoKindStorage implements KindStorage {
  constructor(private readonly memento: Memento) {}

  private read(): StoredKindSet[] {
    const raw = this.memento.get<unknown>(KEY);
    // Whatever is stored is untrusted until it has the right shape; it is recompiled before use.
    return Array.isArray(raw) ? raw.filter(isStoredKindSet) : [];
  }
  list(): Promise<StoredKindSet[]> {
    return Promise.resolve(this.read());
  }
  async put(set: StoredKindSet): Promise<void> {
    await this.memento.update(KEY, [...this.read().filter((s) => s.id !== set.id), set]);
  }
  async remove(id: string): Promise<void> {
    await this.memento.update(
      KEY,
      this.read().filter((s) => s.id !== id),
    );
  }
}

export function createStore(memento: Memento | undefined): KindStore {
  return new KindStore(memento ? new MementoKindStorage(memento) : new MemoryKindStorage());
}

/** Registry files named in the `kinds` setting: a file, or every .json file in a folder. */
export function readConfiguredKinds(
  paths: string[],
  resolve: (p: string) => string,
): StoredKindSet[] {
  const sets: StoredKindSet[] = [];
  for (const path of paths) {
    const full = resolve(path);
    const files = statSync(full).isDirectory()
      ? readdirSync(full)
          .filter((f) => /\.json$/.test(f))
          .sort()
          .map((f) => `${full}/${f}`)
      : [full];
    for (const file of files) {
      const read = parseKindBundle(readFileSync(file, 'utf8'), file);
      if (read.malformed > 0)
        throw new RuleError(`${file}: ${read.malformed} entries are not valid saved schemas.`);
      sets.push(...read.sets);
    }
  }
  return sets;
}

/** Rules for the configured registry files plus the saved kinds, with what went wrong, if anything. */
export function kindRules(configured: StoredKindSet[], saved: StoredKindSet[]) {
  const loaded = loadStoredKinds([...configured, ...saved]);
  const problems = [
    ...loaded.problems.map((p) => `${p.id} could not be loaded: ${p.message}`),
    ...loaded.rejected.map((r) => `${r.kind} ${r.version} was not registered: ${r.reason}`),
  ];
  return { rules: loaded.rules, problems };
}

/** CRD YAML or an OpenAPI schema? A CRD names itself; anything else is treated as OpenAPI. */
export function detectFormat(text: string): 'crd' | 'openapi' {
  return /CustomResourceDefinition/.test(text) ? 'crd' : 'openapi';
}

/** Whether a document looks like a schema worth offering to import. */
export function looksLikeSchema(text: string): boolean {
  return /CustomResourceDefinition|x-kubernetes-group-version-kind|openAPIV3Schema|"definitions"|^definitions:/m.test(
    text,
  );
}

/** Parse `group/version Kind` or `version Kind` (core group), as typed by the user. */
export function parseIdentity(input: string): SchemaIdentity | undefined {
  const m =
    /^\s*(?:([a-z0-9.-]+)\/)?(v\d+(?:(?:alpha|beta)\d+)?)\s+([A-Za-z][A-Za-z0-9]*)\s*$/.exec(input);
  return m ? { group: m[1] ?? '', version: m[2] as string, kind: m[3] as string } : undefined;
}

/** Compile text with the shared importers; the caller shows the preview and decides to register. */
export function compileSchema(format: 'crd' | 'openapi', text: string, identity?: SchemaIdentity) {
  return format === 'crd'
    ? importCrds(text, 'your CRD')
    : importOpenApi(text, identity, 'your schema');
}
