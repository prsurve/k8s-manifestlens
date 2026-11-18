import type { ExplainResult } from '@k8s-manifestlens/core';
import { classifyKind, supportedKinds } from '@k8s-manifestlens/core';

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
      out.push(`! ${unsupportedNotice(doc.kind, doc.apiVersion)}`);
    }

    const shown = new Set<string>();
    const width = String(Math.max(...doc.fields.map((f) => f.line), 1)).length;
    for (const field of doc.fields) {
      const text = (lines[field.line - 1] ?? '').trimEnd();
      out.push('', `${String(field.line).padStart(width)} | ${text}`);
      if (field.explanation) {
        out.push(`${' '.repeat(width)} |   ${field.explanation}`);
        // Show each link once per document so the output stays readable.
        if (field.docsUrl && !shown.has(field.docsUrl)) {
          shown.add(field.docsUrl);
          out.push(`${' '.repeat(width)} |   Docs: ${field.docsUrl}`);
        }
      }
    }
    out.push('');
  }
  return out.join('\n');
}

/** Why a kind has no explanations, and what to do about it. */
function unsupportedNotice(kind: string, apiVersion: string | undefined): string {
  const lead = `No field explanations for kind "${kind}" yet`;
  const c = classifyKind(kind, apiVersion);
  if (c.category === 'missing-builtin') {
    return `${lead}. It is a built-in Kubernetes kind that k8s-manifestlens does not cover yet. Add its schema with: k8s-manifestlens kinds add <openapi-file> --kind ${kind} --version <v> --group <g>`;
  }
  if (c.category === 'custom') {
    return `${lead}. ${apiVersion ?? ''} is a custom resource: pass its CRD with --crd <file>, or save it with: k8s-manifestlens kinds add <crd-file>`;
  }
  if (c.category === 'malformed')
    return `${lead}: ${c.reason ?? 'the resource identity is not valid.'}`;
  return `${lead} (supported: ${supportedKinds().join(', ')}). It is not a known Kubernetes kind: check the spelling.`;
}
