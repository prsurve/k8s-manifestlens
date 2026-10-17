import { checkManifest, explainManifest } from '@manifestlens/core';
import type { ExplainResult, Rule, Severity } from '@manifestlens/core';

/** Editor-independent description of one squiggle; extension.ts turns these into vscode objects. */
export interface Problem {
  /** 0-based line. */
  line: number;
  startColumn: number;
  endColumn: number;
  severity: Severity;
  message: string;
  ruleId: string;
}

const ORDER: Record<Severity, number> = { info: 0, warning: 1, error: 2 };

/**
 * Cheap guard so ordinary YAML files (CI configs, Helm templates, docker-compose) are left alone:
 * only text that declares both `apiVersion` and `kind` is treated as a Kubernetes manifest.
 */
export function looksLikeKubernetes(text: string): boolean {
  return /^apiVersion:\s*\S/m.test(text) && /^kind:\s*\S/m.test(text) && !text.includes('{{');
}

/** Run the rules over a document and describe each finding as a problem on a line. */
export function findProblems(text: string, rules: Rule[], minimum: Severity = 'info'): Problem[] {
  if (!looksLikeKubernetes(text)) return [];
  const lines = text.split(/\r?\n/);
  const problems: Problem[] = [];

  for (const doc of checkManifest(text, rules).documents) {
    for (const issue of doc.issues) {
      const line = Math.max((issue.line ?? 1) - 1, 0);
      problems.push({
        ...range(lines, line),
        severity: 'error',
        message: issue.message,
        ruleId: 'yaml-syntax',
        line,
      });
    }
    for (const f of doc.findings) {
      if (ORDER[f.severity] < ORDER[minimum]) continue;
      const line = Math.max(f.line - 1, 0);
      const message = [f.message, f.why && `Why: ${f.why}`, f.fix && `Fix: ${f.fix}`]
        .filter(Boolean)
        .join('\n');
      problems.push({
        ...range(lines, line),
        severity: f.severity,
        message,
        ruleId: f.ruleId,
        line,
      });
    }
  }
  return problems;
}

/** Column range covering the text of a line, without leading indentation or `- `. */
function range(lines: string[], line: number): Pick<Problem, 'startColumn' | 'endColumn'> {
  const text = lines[line] ?? '';
  const start = text.length - text.trimStart().length;
  return { startColumn: start, endColumn: Math.max(text.trimEnd().length, start) };
}

/** Markdown for a hover on a 1-based line of an explained manifest, or undefined if nothing applies. */
export function hoverMarkdown(result: ExplainResult, line: number): string | undefined {
  for (const doc of result.documents) {
    const field = doc.fields.find((f) => f.line === line && f.explanation);
    if (!field) continue;
    const parts = [`**${inlineCode(field.path)}**`, field.explanation as string];
    if (field.docsUrl) parts.push(`[Kubernetes docs](${field.docsUrl})`);
    return parts.join('\n\n');
  }
  return undefined;
}

/** Keys come from the user's file, so keep them from breaking out of the code span. */
function inlineCode(text: string): string {
  return `\`${text.replace(/[`\r\n]/g, ' ')}\``;
}

/** A readable markdown explanation of the whole file, for the "Explain this manifest" command. */
export function explainAsMarkdown(text: string): string {
  const result = explainManifest(text);
  const lines = text.split(/\r?\n/);
  if (result.documents.length === 0) return '# ManifestLens\n\nNo Kubernetes documents found.\n';

  const out = ['# ManifestLens explanation', ''];
  for (const doc of result.documents) {
    const name = doc.name ? ` "${doc.name.replace(/[`\r\n]/g, ' ')}"` : '';
    out.push(`## ${doc.kind ?? 'Unknown object'}${name}`, '');
    for (const issue of doc.issues)
      out.push(`> ${issue.line ? `Line ${issue.line}: ` : ''}${issue.message}`, '');
    if (doc.unsupportedKind && doc.kind) {
      out.push(`> No field explanations for kind \`${doc.kind.replace(/`/g, ' ')}\` yet.`, '');
    }
    const shown = new Set<string>();
    for (const f of doc.fields) {
      if (!f.explanation) continue;
      const source = (lines[f.line - 1] ?? '').trim().replace(/`/g, "'");
      const link = f.docsUrl && !shown.has(f.docsUrl) ? ` ([docs](${f.docsUrl}))` : '';
      if (f.docsUrl) shown.add(f.docsUrl);
      out.push(`- **Line ${f.line}** \`${source}\`: ${f.explanation}${link}`);
    }
    out.push('');
  }
  return out.join('\n');
}
