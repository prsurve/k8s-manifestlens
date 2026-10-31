import type { CheckResult, Finding, Severity } from '@k8s-manifestlens/core';
import { coverageLines } from './format-fix.js';

const LEVELS: Severity[] = ['error', 'warning', 'info'];

/** Render check findings as plain text. */
export function formatFindings(result: CheckResult): string {
  const out: string[] = [];
  const totals: Record<Severity, number> = { error: 0, warning: 0, info: 0 };

  for (const doc of result.documents) {
    const title = doc.kind
      ? `${doc.kind}${doc.name ? ` "${doc.name}"` : ''}${doc.apiVersion ? ` (${doc.apiVersion})` : ''}`
      : 'Unknown object';
    out.push(
      `== ${title}, document ${doc.index + 1} of ${result.documents.length}, line ${doc.startLine} ==`,
    );
    for (const issue of doc.issues) {
      out.push(`! ${issue.line ? `line ${issue.line}: ` : ''}${issue.message}`);
    }
    if (doc.coverage.level !== 'checked') {
      out.push(...coverageLines(doc.kind ?? 'Unknown object', doc.startLine, doc.coverage));
    }
    if (doc.findings.length === 0 && doc.issues.length === 0) {
      out.push(doc.coverage.level === 'checked' ? 'No issues found.' : 'No findings.');
    }
    for (const f of doc.findings) {
      totals[f.severity]++;
      out.push(...formatFinding(f));
    }
    out.push('');
  }

  const count = LEVELS.reduce((n, l) => n + totals[l], 0);
  out.push(
    `${count} finding${count === 1 ? '' : 's'}: ` +
      LEVELS.map((l) => `${totals[l]} ${l}`).join(', '),
  );
  const unchecked = result.documents.filter((d) => d.coverage.level !== 'checked').length;
  if (unchecked > 0) {
    out.push(
      `${unchecked} of ${result.documents.length} document${result.documents.length === 1 ? '' : 's'} not fully checked (no rules for their kind).`,
    );
  }
  return out.join('\n');
}

function formatFinding(f: Finding): string[] {
  const lines = ['', `line ${f.line}  ${f.severity.toUpperCase()}  ${f.ruleId}`, `  ${f.message}`];
  if (f.why) lines.push(`  Why: ${f.why}`);
  if (f.fix) lines.push(`  Fix: ${f.fix}`);
  return lines;
}
