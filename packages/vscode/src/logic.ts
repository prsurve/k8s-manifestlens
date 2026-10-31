import {
  checkManifest,
  explainManifest,
  fixManifest,
  lineEdits,
  looksLikeKubernetes,
} from '@k8s-manifestlens/core';
import type { ExplainResult, FixOptions, FixResult, Rule, Severity } from '@k8s-manifestlens/core';

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

export { looksLikeKubernetes };

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
    // A kind nobody knows gets no findings, which would look like a clean bill of health.
    if (doc.coverage.level === 'unchecked' && doc.coverage.message && minimum === 'info') {
      const line = Math.max(doc.startLine - 1, 0);
      problems.push({
        ...range(lines, line),
        severity: 'info',
        message: doc.coverage.message,
        ruleId: 'unsupported-kind',
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
  if (result.documents.length === 0)
    return '# k8s-manifestlens\n\nNo Kubernetes documents found.\n';

  const out = ['# k8s-manifestlens explanation', ''];
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

/** A fix as an editor edit: replace `deleteCount` whole lines from `startLine` (0-based) with `text`. */
export interface LineReplacement {
  startLine: number;
  deleteCount: number;
  text: string;
}

export interface PlannedFix {
  result: FixResult;
  edits: LineReplacement[];
}

/** Compute fixes for a document and express them as line edits. Nothing is applied here. */
export function planFix(text: string, rules: Rule[], options: FixOptions): PlannedFix {
  const result = fixManifest(text, rules, options);
  const edits =
    result.status === 'fixed'
      ? lineEdits(result.original, result.fixed).map((e) => ({
          startLine: e.start,
          deleteCount: e.deleteCount,
          text: e.insert.join(''),
        }))
      : [];
  return { result, edits };
}

/** Title for a quick fix, naming the risk when it needs a second look. */
export function fixTitle(result: FixResult): string | undefined {
  const first = result.applied[0];
  if (!first || result.status !== 'fixed') return undefined;
  const extra = result.applied.length > 1 ? ` (+${result.applied.length - 1} more)` : '';
  const risk = first.risk === 'low' ? '' : ` [${first.risk} risk: review]`;
  return `k8s-manifestlens: ${first.summary}${extra}${risk}`;
}
