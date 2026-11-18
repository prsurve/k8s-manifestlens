import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  KindStore,
  RuleError,
  formatPreview,
  importCrds,
  importOpenApi,
} from '@k8s-manifestlens/core';
import type { SchemaIdentity } from '@k8s-manifestlens/core';
import type { Io } from './main.js';
import { FileKindStorage, registryPath } from './registry.js';

export const KINDS_USAGE = `Usage:
  k8s-manifestlens kinds list
  k8s-manifestlens kinds preview <file> [schema options]
  k8s-manifestlens kinds add <file> [schema options]
  k8s-manifestlens kinds remove|enable|disable <id-or-kind>
  k8s-manifestlens kinds export [--out <file>]
  k8s-manifestlens kinds import <file>
  k8s-manifestlens kinds path

Manage the local registry of imported kinds (custom resources, or built-in kinds that
k8s-manifestlens does not cover). check, explain, diff and fix use it automatically.

Schema options (for an OpenAPI schema that does not name its own kind):
  --format crd|openapi   Default: detected from the file
  --group <g> --version <v> --kind <k> [--scope Namespaced|Cluster]

Options:
  --registry <file>      Registry location (default: $K8S_MANIFESTLENS_REGISTRY, else
                         ~/.config/k8s-manifestlens/kinds.json)
`;

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** `k8s-manifestlens kinds ...`. Async because the store is; the other commands stay synchronous. */
export async function runKinds(argv: string[], io: Io): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        registry: { type: 'string' },
        format: { type: 'string' },
        group: { type: 'string' },
        version: { type: 'string' },
        kind: { type: 'string' },
        scope: { type: 'string' },
        out: { type: 'string' },
      },
    });
  } catch (err) {
    io.stderr(`${msg(err)}\n\n${KINDS_USAGE}`);
    return 2;
  }
  const { values } = parsed;
  const [action, arg, ...extra] = parsed.positionals;
  if (values.help) {
    io.stdout(KINDS_USAGE);
    return 0;
  }
  const path = registryPath(values.registry);
  const store = new KindStore(new FileKindStorage(path));
  const needsArg = ['preview', 'add', 'remove', 'enable', 'disable', 'import'];
  if (
    !action ||
    !['list', 'path', 'export', ...needsArg].includes(action) ||
    extra.length > 0 ||
    (needsArg.includes(action) && !arg)
  ) {
    io.stderr(KINDS_USAGE);
    return 2;
  }

  try {
    if (action === 'path') {
      io.stdout(`${path}\n`);
      return 0;
    }
    if (action === 'list') {
      const sets = await store.list();
      const loaded = await store.load();
      if (sets.length === 0) io.stdout('No imported kinds.\n');
      for (const s of sets) {
        const kinds = s.kinds.map((k) => `${k.kind} (${k.versions.join(', ')})`).join(', ');
        io.stdout(`${s.id}\t${s.enabled ? 'enabled' : 'disabled'}\t${kinds}\n`);
      }
      for (const p of loaded.problems) io.stderr(`${p.id} could not be loaded: ${p.message}\n`);
      return loaded.problems.length > 0 ? 1 : 0;
    }
    if (action === 'export') {
      const json = await store.export();
      if (values.out) {
        const { writeFileSync } = await import('node:fs');
        writeFileSync(values.out, `${json}\n`);
      } else io.stdout(`${json}\n`);
      return 0;
    }
    if (action === 'import') {
      const r = await store.import(readFileSync(arg as string, 'utf8'));
      io.stdout(`Imported ${r.imported.length}.\n`);
      for (const s of r.skipped) io.stderr(`Skipped ${s.id}: ${s.message}\n`);
      return r.skipped.length > 0 ? 1 : 0;
    }
    if (action === 'preview' || action === 'add') return await addOrPreview(action, arg as string);
    return await change(action as 'remove' | 'enable' | 'disable', arg as string);
  } catch (err) {
    io.stderr(`${msg(err)}\n`);
    return err instanceof RuleError ? 1 : 2;
  }

  async function addOrPreview(mode: 'preview' | 'add', file: string): Promise<number> {
    const text = readFileSync(file, 'utf8');
    const format =
      values.format === 'crd' || values.format === 'openapi'
        ? values.format
        : /CustomResourceDefinition/.test(text)
          ? 'crd'
          : 'openapi';
    if (values.format !== undefined && values.format !== format) {
      io.stderr('--format must be crd or openapi.\n');
      return 2;
    }
    const identity: SchemaIdentity | undefined =
      values.kind && values.version
        ? {
            group: values.group ?? '',
            version: values.version,
            kind: values.kind,
            ...(values.scope === 'Namespaced' || values.scope === 'Cluster'
              ? { scope: values.scope }
              : {}),
          }
        : undefined;
    const compiled =
      format === 'crd' ? importCrds(text, file) : importOpenApi(text, identity, file);
    io.stdout(`${formatPreview(compiled.previews)}\n`);
    if (mode === 'preview') return 0;
    const out = await store.add(format, text, { origin: file, ...(identity ? { identity } : {}) });
    for (const r of out.registration.rejected) {
      io.stderr(`Not registered: ${r.kind} ${r.version}: ${r.reason}\n`);
    }
    const done = [...out.registration.added, ...out.registration.updated];
    if (done.length === 0) return 1;
    io.stdout(`Registered ${done.join(', ')} in ${path}\n`);
    return 0;
  }

  async function change(op: 'remove' | 'enable' | 'disable', key: string): Promise<number> {
    const hits = (await store.list()).filter(
      (s) => s.id === key || s.kinds.some((k) => k.kind === key),
    );
    if (hits.length !== 1) {
      io.stderr(
        hits.length === 0
          ? `No imported kind matches "${key}". See: k8s-manifestlens kinds list\n`
          : `"${key}" matches several entries (${hits.map((h) => h.id).join(', ')}); use the id.\n`,
      );
      return 2;
    }
    const id = (hits[0] as { id: string }).id;
    if (op === 'remove') await store.remove(id);
    else await store.setEnabled(id, op === 'enable');
    io.stdout(`${op === 'remove' ? 'Removed' : op === 'enable' ? 'Enabled' : 'Disabled'} ${id}\n`);
    return 0;
  }
}
