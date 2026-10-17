import { formatValue as show } from '@manifestlens/core';
import type { DiffResult, DocumentDiff, FieldChange, Finding } from '@manifestlens/core';

const SIGN = { added: '+', removed: '-', changed: '~' } as const;

/** Render a diff result as plain text. */
export function formatDiff(result: DiffResult): string {
  const out: string[] = [];
  for (const issue of result.issues) {
    out.push(`! ${issue.side} file${issue.line ? `, line ${issue.line}` : ''}: ${issue.message}`);
  }
  if (result.issues.length > 0) out.push('');

  const counts = { added: 0, removed: 0, changed: 0, unchanged: 0 };
  let introduced = 0;
  let resolved = 0;
  for (const doc of result.documents) {
    counts[doc.status]++;
    introduced += doc.newFindings.length;
    resolved += doc.resolvedFindings.length;
    if (
      doc.status !== 'unchanged' ||
      doc.newFindings.length > 0 ||
      doc.resolvedFindings.length > 0
    ) {
      out.push(...formatDocument(doc), '');
    }
  }

  out.push(
    `${counts.changed} changed, ${counts.added} added, ${counts.removed} removed, ${counts.unchanged} unchanged. ` +
      `Findings: ${introduced} new, ${resolved} resolved.`,
  );
  return out.join('\n');
}

function formatDocument(doc: DocumentDiff): string[] {
  const ns = doc.namespace ? ` in namespace ${doc.namespace}` : '';
  const out = [`== ${doc.kind} "${doc.name}"${ns}: ${doc.status} ==`];
  for (const note of doc.notes) out.push(note);

  const shown = new Set<string>();
  for (const change of doc.changes) out.push(...formatChange(change, shown));

  if (doc.newFindings.length > 0) {
    out.push('', doc.status === 'added' ? 'Findings for this new object:' : 'New findings:');
    for (const f of doc.newFindings) out.push(...formatFinding(f));
  }
  if (doc.resolvedFindings.length > 0) {
    out.push('', 'Resolved findings:');
    for (const f of doc.resolvedFindings)
      out.push(`  ${f.severity.toUpperCase()}  ${f.ruleId}  ${f.message}`);
  }
  return out;
}

function formatChange(change: FieldChange, shown: Set<string>): string[] {
  const isObject = (v: unknown) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const value =
    change.type === 'changed'
      ? `: ${show(change.before)} -> ${show(change.after)}`
      : isObject(change.type === 'added' ? change.after : change.before)
        ? ''
        : `: ${show(change.type === 'added' ? change.after : change.before)}`;
  const where =
    change.type === 'removed' ? 'line ' + change.line + ' (old file)' : `line ${change.line}`;
  const out = ['', `${where}  ${SIGN[change.type]} ${change.path}${value}`];
  if (change.effect) out.push(`  Effect: ${change.effect}`);
  else if (change.explanation) out.push(`  About: ${change.explanation}`);
  if (change.docsUrl && !shown.has(change.docsUrl)) {
    shown.add(change.docsUrl);
    out.push(`  Docs: ${change.docsUrl}`);
  }
  return out;
}

function formatFinding(f: Finding): string[] {
  const out = [`  line ${f.line}  ${f.severity.toUpperCase()}  ${f.ruleId}  ${f.message}`];
  if (f.fix) out.push(`    Fix: ${f.fix}`);
  return out;
}
