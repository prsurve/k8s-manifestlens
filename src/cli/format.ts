import type { ExplainResult } from '../core/index.js';
import { supportedKinds } from '../core/index.js';

/** Render an explain result as plain text, one block per source line. */
export function formatExplanation(result: ExplainResult, source: string): string {
  const lines = source.split(/\r?\n/);
  const out: string[] = [];
  const total = result.documents.length;

  for (const doc of result.documents) {
    const title = doc.kind
      ? `${doc.kind}${doc.name ? ` "${doc.name}"` : ''}${doc.apiVersion ? ` (${doc.apiVersion})` : ''}`
      : 'Unknown object';
    out.push(`== ${title}, document ${doc.index + 1} of ${total}, line ${doc.startLine} ==`);

    for (const issue of doc.issues) {
      out.push(`! ${issue.line ? `line ${issue.line}: ` : ''}${issue.message}`);
    }
    if (doc.unsupportedKind && doc.kind) {
      out.push(
        `! No field explanations for kind "${doc.kind}" yet (supported: ${supportedKinds().join(', ')}).`,
      );
    }

    const width = String(Math.max(...doc.fields.map((f) => f.line), 1)).length;
    for (const field of doc.fields) {
      const text = (lines[field.line - 1] ?? '').trimEnd();
      out.push('', `${String(field.line).padStart(width)} | ${text}`);
      if (field.explanation) {
        out.push(`${' '.repeat(width)} |   ${field.explanation}`);
      }
    }
    out.push('');
  }
  return out.join('\n');
}
