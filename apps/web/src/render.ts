import { formatValue } from '@manifestlens/core';
import type {
  CheckResult,
  DiffResult,
  DocumentDiff,
  ExplainResult,
  FieldChange,
  Finding,
  Severity,
} from '@manifestlens/core';
import { docsLink, el } from './dom.js';

const SEVERITIES: Severity[] = ['error', 'warning', 'info'];

export function renderMessage(text: string): HTMLElement {
  return el('p', { class: 'empty', text });
}

function title(doc: {
  kind?: string | undefined;
  name?: string | undefined;
  apiVersion?: string | undefined;
}) {
  if (!doc.kind) return 'Unknown object';
  return `${doc.kind}${doc.name ? ` "${doc.name}"` : ''}${doc.apiVersion ? ` (${doc.apiVersion})` : ''}`;
}

function issues(list: { message: string; line?: number | undefined }[]): HTMLElement[] {
  return list.map((i) =>
    el('p', { class: 'issue', text: `${i.line ? `Line ${i.line}: ` : ''}${i.message}` }),
  );
}

export function renderExplain(result: ExplainResult, source: string): HTMLElement {
  const lines = source.split(/\r?\n/);
  const root = el('div');
  for (const doc of result.documents) {
    const rows = doc.fields.map((f) => {
      const text = (lines[f.line - 1] ?? '').trimEnd();
      return el('li', { class: 'row' }, [
        el('span', { class: 'ln', text: String(f.line) }),
        el('div', { class: 'cell' }, [
          el('code', { text }),
          f.explanation && el('p', { class: 'explain', text: f.explanation }),
          f.docsUrl && docsLink(f.docsUrl),
        ]),
      ]);
    });
    root.append(
      el('section', { class: 'doc' }, [
        el('h2', { text: title(doc) }),
        ...issues(doc.issues),
        doc.unsupportedKind &&
          doc.kind &&
          el('p', {
            class: 'issue',
            text: `No field explanations for kind "${doc.kind}" yet (supported: Pod, Deployment, Service).`,
          }),
        el('ul', { class: 'rows' }, rows),
      ]),
    );
  }
  return root;
}

function findingCard(f: Finding): HTMLElement {
  return el('article', { class: `finding sev-${f.severity}` }, [
    el('div', { class: 'finding-head' }, [
      el('span', { class: 'badge', text: f.severity }),
      el('span', { class: 'rule-id', text: f.ruleId }),
      el('span', { class: 'at', text: `line ${f.line}` }),
    ]),
    el('p', { class: 'msg', text: f.message }),
    f.why && el('p', {}, [el('strong', { text: 'Why: ' }), f.why]),
    f.fix && el('p', {}, [el('strong', { text: 'Fix: ' }), f.fix]),
  ]);
}

function counts(findings: Finding[]): HTMLElement {
  const wrap = el('p', { class: 'counts' });
  for (const s of SEVERITIES) {
    const n = findings.filter((f) => f.severity === s).length;
    wrap.append(el('span', { class: `chip sev-${s}`, text: `${n} ${s}` }));
  }
  return wrap;
}

export function renderCheck(result: CheckResult): HTMLElement {
  const root = el('div');
  const all = result.documents.flatMap((d) => d.findings);
  root.append(
    el('p', {
      class: 'summary',
      text:
        all.length === 0
          ? 'No issues found.'
          : `${all.length} finding${all.length === 1 ? '' : 's'}`,
    }),
  );
  if (all.length > 0) root.append(counts(all));
  for (const doc of result.documents) {
    root.append(
      el('section', { class: 'doc' }, [
        el('h2', { text: title(doc) }),
        ...issues(doc.issues),
        ...doc.findings.map(findingCard),
      ]),
    );
  }
  return root;
}

const SIGN = { added: '+', removed: '-', changed: '~' } as const;

function changeRow(c: FieldChange): HTMLElement {
  const isObj = (v: unknown) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const value =
    c.type === 'changed'
      ? `${formatValue(c.before)} → ${formatValue(c.after)}`
      : isObj(c.type === 'added' ? c.after : c.before)
        ? ''
        : formatValue(c.type === 'added' ? c.after : c.before);
  return el('li', { class: `change ch-${c.type}` }, [
    el('code', { text: `${SIGN[c.type]} ${c.path}${value ? `: ${value}` : ''}` }),
    el('span', {
      class: 'at',
      text: c.type === 'removed' ? `line ${c.line} (old file)` : `line ${c.line}`,
    }),
    c.effect
      ? el('p', {}, [el('strong', { text: 'Effect: ' }), c.effect])
      : c.explanation && el('p', { class: 'explain', text: c.explanation }),
    c.docsUrl && docsLink(c.docsUrl),
  ]);
}

function diffDocument(doc: DocumentDiff): HTMLElement {
  const ns = doc.namespace ? ` in namespace ${doc.namespace}` : '';
  return el('section', { class: 'doc' }, [
    el('h2', {}, [
      `${doc.kind} "${doc.name}"${ns} `,
      el('span', { class: `status st-${doc.status}`, text: doc.status }),
    ]),
    ...doc.notes.map((n) => el('p', { class: 'note', text: n })),
    doc.changes.length > 0 && el('ul', { class: 'changes' }, doc.changes.map(changeRow)),
    doc.newFindings.length > 0 &&
      el('div', {}, [
        el('h3', {
          text: doc.status === 'added' ? 'Findings for this new object' : 'New findings',
        }),
        ...doc.newFindings.map(findingCard),
      ]),
    doc.resolvedFindings.length > 0 &&
      el('div', {}, [
        el('h3', { text: 'Resolved findings' }),
        el(
          'ul',
          { class: 'resolved' },
          doc.resolvedFindings.map((f) =>
            el('li', { text: `${f.severity.toUpperCase()}  ${f.ruleId}: ${f.message}` }),
          ),
        ),
      ]),
  ]);
}

export function renderDiff(result: DiffResult): HTMLElement {
  const root = el('div');
  for (const i of result.issues) {
    root.append(
      el('p', {
        class: 'issue',
        text: `${i.side} file${i.line ? `, line ${i.line}` : ''}: ${i.message}`,
      }),
    );
  }
  const shown = result.documents.filter(
    (d) => d.status !== 'unchanged' || d.newFindings.length > 0 || d.resolvedFindings.length > 0,
  );
  const tally = (s: DocumentDiff['status']) =>
    result.documents.filter((d) => d.status === s).length;
  root.append(
    el('p', {
      class: 'summary',
      text: `${tally('changed')} changed, ${tally('added')} added, ${tally('removed')} removed, ${tally('unchanged')} unchanged`,
    }),
  );
  for (const doc of shown) root.append(diffDocument(doc));
  return root;
}
