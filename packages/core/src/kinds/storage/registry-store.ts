import { RuleError } from '../../rules/load.js';
import type { Rule } from '../../rules/types.js';
import { importCrds } from '../onboarding/crd-importer.js';
import type { KindPreview } from '../onboarding/crd-importer.js';
import { registerKinds } from '../onboarding/kind-registration.js';
import type { RegistrationResult, RejectedKind } from '../onboarding/kind-registration.js';
import { importOpenApi } from '../onboarding/schema-importer.js';
import type { SchemaIdentity } from '../onboarding/schema-importer.js';

/** One imported schema as saved: the original text, so it is recompiled by the one analysis engine. */
export interface StoredKindSet {
  /** Stable id built from the kinds it defines, so importing the same kinds again updates it. */
  id: string;
  format: 'crd' | 'openapi';
  text: string;
  /** Needed to re-read an OpenAPI schema that does not name its own kind. */
  identity?: SchemaIdentity;
  /** The kinds it defines, for listing without recompiling. */
  kinds: { group: string; kind: string; versions: string[] }[];
  enabled: boolean;
  importedAt: string;
}

/** Where sets are kept. The core ships a memory backend; the web app uses IndexedDB, the CLI a file. */
export interface KindStorage {
  list(): Promise<StoredKindSet[]>;
  put(set: StoredKindSet): Promise<void>;
  remove(id: string): Promise<void>;
}

export class MemoryKindStorage implements KindStorage {
  private readonly sets = new Map<string, StoredKindSet>();
  list(): Promise<StoredKindSet[]> {
    return Promise.resolve([...this.sets.values()]);
  }
  put(set: StoredKindSet): Promise<void> {
    this.sets.set(set.id, JSON.parse(JSON.stringify(set)) as StoredKindSet);
    return Promise.resolve();
  }
  remove(id: string): Promise<void> {
    this.sets.delete(id);
    return Promise.resolve();
  }
}

const BUNDLE_FORMAT = 'k8s-manifestlens-kinds';
const MAX_SETS = 500;
const MAX_BUNDLE_BYTES = 64 * 1024 * 1024;

export interface AddResult {
  /** What registering did; `rejected` explains anything refused, e.g. a clash with a built-in. */
  registration: RegistrationResult;
  previews: KindPreview[];
  /** The saved set, absent when nothing could be registered. */
  set?: StoredKindSet;
}

export interface LoadedKinds {
  /** Rules for every enabled set, ready for `explainManifest` and `checkManifest`. */
  rules: Rule[];
  rejected: RejectedKind[];
  /** Saved sets that no longer compile; they are left in storage, never silently dropped. */
  problems: { id: string; message: string }[];
}

const compile = (set: Pick<StoredKindSet, 'format' | 'text' | 'identity'>, origin: string) =>
  set.format === 'crd'
    ? importCrds(set.text, origin)
    : importOpenApi(set.text, set.identity, origin);

/** Imported kinds, saved across sessions. Everything is recompiled from the saved text on load. */
export class KindStore {
  constructor(private readonly storage: KindStorage) {}

  list(): Promise<StoredKindSet[]> {
    return this.storage
      .list()
      .then((all) => all.sort((a, b) => a.importedAt.localeCompare(b.importedAt)));
  }

  /** Compile, register and save a CRD or OpenAPI schema. Throws `RuleError` if the text is invalid. */
  async add(
    format: 'crd' | 'openapi',
    text: string,
    options: { identity?: SchemaIdentity; origin?: string; now?: Date } = {},
  ): Promise<AddResult> {
    const origin = options.origin ?? format;
    const { rules, previews } = compile(
      { format, text, ...(options.identity ? { identity: options.identity } : {}) },
      origin,
    );
    const current = (await this.load()).rules;
    const registration = registerKinds(current, rules);
    if (registration.added.length + registration.updated.length === 0) {
      return { registration, previews };
    }
    const existing = await this.storage.list();
    if (existing.length >= MAX_SETS) {
      throw new RuleError(
        `${origin}: too many imported schemas (the limit is ${MAX_SETS}). Remove some first.`,
      );
    }
    const kinds = previews.map((p) => ({
      group: p.group,
      kind: p.kind,
      versions: p.versions.map((v) => v.version),
    }));
    const id = kinds
      .map((k) => `${k.group}/${k.kind}`)
      .sort()
      .join(',');
    const set: StoredKindSet = {
      id: `${format}:${id}`,
      format,
      text,
      ...(options.identity ? { identity: options.identity } : {}),
      kinds,
      enabled: existing.find((s) => s.id === `${format}:${id}`)?.enabled ?? true,
      importedAt: (options.now ?? new Date()).toISOString(),
    };
    await this.storage.put(set);
    return { registration, previews, set };
  }

  async remove(id: string): Promise<void> {
    await this.storage.remove(id);
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const set = (await this.storage.list()).find((s) => s.id === id);
    if (set) await this.storage.put({ ...set, enabled });
  }

  /** Recompile every enabled set, applying the same conflict rules as when it was imported. */
  async load(): Promise<LoadedKinds> {
    let rules: Rule[] = [];
    const rejected: RejectedKind[] = [];
    const problems: LoadedKinds['problems'] = [];
    for (const set of await this.list()) {
      if (!set.enabled) continue;
      try {
        const result = registerKinds(rules, compile(set, set.id).rules);
        rules = result.rules;
        rejected.push(...result.rejected);
      } catch (e) {
        problems.push({ id: set.id, message: e instanceof Error ? e.message : String(e) });
      }
    }
    return { rules, rejected, problems };
  }

  /** All saved sets as one JSON file, to back up or move to another browser or machine. */
  async export(): Promise<string> {
    return JSON.stringify({ format: BUNDLE_FORMAT, version: 1, sets: await this.list() }, null, 2);
  }

  /**
   * Restore sets from an export. The file is untrusted: its shape is checked and each set must
   * compile before it is saved. Returns the ids imported and why any were skipped.
   */
  async import(
    json: string,
  ): Promise<{ imported: string[]; skipped: { id: string; message: string }[] }> {
    if (json.length > MAX_BUNDLE_BYTES) throw new RuleError('The export file is too large.');
    let data: unknown;
    try {
      data = JSON.parse(json);
    } catch {
      throw new RuleError('The file is not valid JSON.');
    }
    const sets =
      isRecord(data) && data.format === BUNDLE_FORMAT && Array.isArray(data.sets)
        ? data.sets
        : undefined;
    if (sets === undefined) throw new RuleError('This is not a k8s-manifestlens kinds export.');
    if (sets.length > MAX_SETS)
      throw new RuleError(`The file has too many schemas (the limit is ${MAX_SETS}).`);
    const imported: string[] = [];
    const skipped: { id: string; message: string }[] = [];
    for (const raw of sets) {
      const id = isRecord(raw) && typeof raw.id === 'string' ? raw.id : '(unknown)';
      try {
        if (
          !isRecord(raw) ||
          (raw.format !== 'crd' && raw.format !== 'openapi') ||
          typeof raw.text !== 'string'
        ) {
          throw new RuleError('Not a valid saved schema.');
        }
        const identity = isIdentity(raw.identity) ? raw.identity : undefined;
        const result = await this.add(raw.format, raw.text, {
          origin: id,
          ...(identity ? { identity } : {}),
        });
        if (result.set === undefined) {
          throw new RuleError(result.registration.rejected[0]?.reason ?? 'Nothing to register.');
        }
        if (raw.enabled === false) await this.setEnabled(result.set.id, false);
        imported.push(result.set.id);
      } catch (e) {
        skipped.push({ id, message: e instanceof Error ? e.message : String(e) });
      }
    }
    return { imported, skipped };
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

const isIdentity = (v: unknown): v is SchemaIdentity =>
  isRecord(v) &&
  typeof v.group === 'string' &&
  typeof v.version === 'string' &&
  typeof v.kind === 'string';
