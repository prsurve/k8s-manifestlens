import { docsLinkFor, lookupField } from '../fields/index.js';
import { parseManifest } from '../parse.js';
import { loadBundledRules } from '../rules/index.js';
import { checkManifest } from '../rules/check.js';
import type { Finding, Rule } from '../rules/types.js';
import type { ManifestDocument } from '../types.js';
import { diffData, stripServerFields } from './deep.js';
import type { RawChange } from './deep.js';
import { describeEffect } from './effects.js';
import type { DiffIssue, DiffResult, DocumentDiff, FieldChange } from './types.js';

export type {
  ChangeType,
  DiffIssue,
  DiffResult,
  DocumentDiff,
  FieldChange,
  Within,
} from './types.js';

interface Side {
  doc: ManifestDocument;
  findings: Finding[];
}

/**
 * Compare two versions of a manifest and explain what applying the new one will do.
 * Objects are matched by kind, namespace and name. Rule findings that appear or disappear
 * are reported too; pass `rules` to use something other than the bundled rules.
 */
export function diffManifests(
  oldSource: string,
  newSource: string,
  rules: Rule[] = loadBundledRules(),
): DiffResult {
  const issues: DiffIssue[] = [];
  const oldSide = index(oldSource, 'old', rules, issues);
  const newSide = index(newSource, 'new', rules, issues);

  const documents: DocumentDiff[] = [];
  for (const [id, now] of newSide) {
    const before = oldSide.get(id);
    documents.push(before ? compare(before, now) : added(now));
  }
  for (const [id, before] of oldSide) {
    if (!newSide.has(id)) documents.push(removed(before));
  }
  return { documents, issues };
}

function identity(doc: ManifestDocument): string | undefined {
  if (!doc.kind || !doc.name) return undefined;
  const ns = (doc.data?.metadata as { namespace?: unknown } | undefined)?.namespace;
  return `${doc.kind}/${typeof ns === 'string' ? ns : ''}/${doc.name}`;
}

function index(
  source: string,
  side: 'old' | 'new',
  rules: Rule[],
  issues: DiffIssue[],
): Map<string, Side> {
  const checked = checkManifest(source, rules).documents;
  const map = new Map<string, Side>();
  for (const doc of parseManifest(source)) {
    for (const issue of doc.issues) {
      issues.push({ side, message: issue.message, ...(issue.line ? { line: issue.line } : {}) });
    }
    const id = identity(doc);
    if (!id) {
      if (doc.data) {
        issues.push({
          side,
          line: doc.startLine,
          message: 'Skipped a document without kind or metadata.name.',
        });
      }
      continue;
    }
    if (map.has(id)) {
      issues.push({
        side,
        line: doc.startLine,
        message: `Duplicate object ${id}; ignoring the later one.`,
      });
      continue;
    }
    map.set(id, { doc, findings: checked[doc.index]?.findings ?? [] });
  }
  return map;
}

function header(
  doc: ManifestDocument,
): Pick<DocumentDiff, 'kind' | 'name' | 'namespace' | 'apiVersion'> {
  const ns = (doc.data?.metadata as { namespace?: unknown } | undefined)?.namespace;
  return {
    kind: doc.kind ?? '',
    name: doc.name ?? '',
    ...(typeof ns === 'string' ? { namespace: ns } : {}),
    ...(doc.apiVersion ? { apiVersion: doc.apiVersion } : {}),
  };
}

function added(now: Side): DocumentDiff {
  return {
    ...header(now.doc),
    status: 'added',
    newLine: now.doc.startLine,
    changes: [],
    notes: [`This ${now.doc.kind} is new and will be created.`],
    newFindings: now.findings,
    resolvedFindings: [],
  };
}

function removed(before: Side): DocumentDiff {
  return {
    ...header(before.doc),
    status: 'removed',
    oldLine: before.doc.startLine,
    changes: [],
    notes: [
      `This ${before.doc.kind} is no longer in the file. kubectl apply does not delete it unless you use --prune; otherwise it keeps running in the cluster.`,
    ],
    newFindings: [],
    resolvedFindings: [],
  };
}

function compare(before: Side, now: Side): DocumentDiff {
  const kind = now.doc.kind ?? '';
  const raw = diffData(
    stripServerFields(before.doc.data ?? {}),
    stripServerFields(now.doc.data ?? {}),
  );
  const changes = raw.map((r) => toChange(r, kind, before.doc, now.doc));

  const key = (f: Finding) => `${f.ruleId}|${f.message}`;
  const oldKeys = new Set(before.findings.map(key));
  const newKeys = new Set(now.findings.map(key));

  return {
    ...header(now.doc),
    status: changes.length > 0 ? 'changed' : 'unchanged',
    oldLine: before.doc.startLine,
    newLine: now.doc.startLine,
    changes,
    notes: changes.length > 0 ? notesFor(kind, changes, now.doc) : [],
    newFindings: now.findings.filter((f) => !oldKeys.has(key(f))),
    resolvedFindings: before.findings.filter((f) => !newKeys.has(key(f))),
  };
}

function toChange(
  r: RawChange,
  kind: string,
  oldDoc: ManifestDocument,
  newDoc: ManifestDocument,
): FieldChange {
  const pattern = r.path.replace(/\[\d+\]/g, '[]');
  const doc = r.type === 'removed' ? oldDoc : newDoc;
  const change: FieldChange = {
    type: r.type,
    path: r.path,
    pattern,
    line: lineOf(doc, r.path),
    within: r.within,
    ...('before' in r ? { before: r.before } : {}),
    ...('after' in r ? { after: r.after } : {}),
  };
  const effect = describeEffect(kind, change);
  const explanation = lookupField(kind, pattern);
  const docsUrl = docsLinkFor(kind, pattern);
  return {
    ...change,
    ...(effect !== undefined ? { effect } : {}),
    ...(explanation !== undefined ? { explanation } : {}),
    ...(docsUrl !== undefined && explanation !== undefined ? { docsUrl } : {}),
  };
}

/** Line of a field, or of the first field inside it when it is a list item or similar. */
function lineOf(doc: ManifestDocument, path: string): number {
  const exact = doc.fields.find((f) => f.path === path);
  if (exact) return exact.line;
  const inside = doc.fields.filter(
    (f) => f.path.startsWith(`${path}.`) || f.path.startsWith(`${path}[`),
  );
  return inside.length > 0 ? Math.min(...inside.map((f) => f.line)) : doc.startLine;
}

function notesFor(kind: string, changes: FieldChange[], now: ManifestDocument): string[] {
  if (kind !== 'Deployment') return [];
  const data = now.data ?? {};
  const spec = (data.spec ?? {}) as { paused?: unknown; strategy?: { type?: unknown } };
  const touchesTemplate = changes.some((c) => c.path.startsWith('spec.template'));
  if (touchesTemplate && spec.paused !== true) {
    return [
      spec.strategy?.type === 'Recreate'
        ? 'The Pod template changes, so Kubernetes will stop all old Pods and then start new ones (strategy Recreate). Expect downtime during the rollout.'
        : 'The Pod template changes, so Kubernetes will start new Pods and remove the old ones gradually (a rolling update). The app stays available if its readiness checks are set up.',
    ];
  }
  if (!touchesTemplate) {
    return [
      'The Pod template is unchanged, so no rollout happens and running Pods are not restarted.',
    ];
  }
  return [];
}
