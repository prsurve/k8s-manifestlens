import { checkManifest, diffManifests } from '@manifestlens/core';
import type { Rule } from '@manifestlens/core';
import { minimatch } from 'minimatch';
import type { Analysis, ChangedObject, LocatedFinding, ParseProblem, Settings } from './types.js';

export interface FileToAnalyze {
  path: string;
  text: string;
  /**
   * The file as it was at the base commit, for `scope: new`. `null` means the file is new in this
   * change; `undefined` means no comparison was asked for.
   */
  base?: string | null | undefined;
}

const ORDER = { error: 0, warning: 1, info: 2 } as const;
const MAX_EFFECTS_PER_OBJECT = 6;

/** Apply `disable-rules` and `severity-overrides`, and report ids that match no rule. */
export function prepareRules(all: Rule[], s: Settings): { rules: Rule[]; unknown: string[] } {
  const known = new Set(all.map((r) => r.id));
  const named = [
    ...s.disableRules,
    ...Object.keys(s.severityOverrides),
    ...s.ignore.flatMap((i) => i.rules ?? []),
  ];
  const unknown = [...new Set(named.filter((id) => id !== 'all' && !known.has(id)))];

  const off = new Set(s.disableRules);
  const rules: Rule[] = [];
  for (const rule of all) {
    if (off.has(rule.id)) continue;
    const override = s.severityOverrides[rule.id];
    if (override === 'off') continue;
    rules.push(override ? { ...rule, severity: override } : rule);
  }
  return { rules, unknown };
}

const INLINE = /manifestlens-ignore:\s*([A-Za-z0-9_, -]+)/;

/**
 * A `# manifestlens-ignore: rule-id, other-rule` comment on the finding's line, or on a comment
 * line just above it, silences those rules there. `all` silences every rule.
 */
function suppressedInline(lines: string[], line: number, ruleId: string): boolean {
  const candidates = [
    lines[line - 1],
    lines[line - 2]?.trimStart().startsWith('#') ? lines[line - 2] : undefined,
  ];
  for (const text of candidates) {
    const m = text ? INLINE.exec(text) : null;
    if (!m) continue;
    const ids = (m[1] as string).split(/[,\s]+/).filter(Boolean);
    if (ids.includes('all') || ids.includes(ruleId)) return true;
  }
  return false;
}

function suppressedByConfig(file: string, ruleId: string, s: Settings): boolean {
  return s.ignore.some((entry) => {
    const pathMatches = entry.path === undefined || minimatch(file, entry.path, { dot: true });
    const ruleMatches =
      entry.rules === undefined || entry.rules.includes(ruleId) || entry.rules.includes('all');
    return pathMatches && ruleMatches;
  });
}

const label = (kind?: string, name?: string): string =>
  kind ? `${kind}${name ? ` "${name}"` : ''}` : 'object';

/** Run the rules over the files and apply every kind of ignore. */
export function analyze(files: FileToAnalyze[], allRules: Rule[], s: Settings): Analysis {
  const { rules, unknown } = prepareRules(allRules, s);
  const result: Analysis = {
    findings: [],
    parseProblems: [],
    suppressed: 0,
    filesChecked: files.length,
    changes: [],
    notChecked: [],
    unknownRules: unknown,
  };

  for (const file of files) {
    const lines = file.text.split(/\r?\n/);
    const keep = (f: LocatedFinding): void => {
      if (suppressedByConfig(file.path, f.ruleId, s) || suppressedInline(lines, f.line, f.ruleId)) {
        result.suppressed++;
      } else {
        result.findings.push(f);
      }
    };
    const problem = (p: ParseProblem): void => void result.parseProblems.push(p);

    if (s.scope === 'new' && file.base !== undefined) {
      const diff = diffManifests(file.base ?? '', file.text, rules);
      for (const issue of diff.issues) {
        if (issue.side === 'new')
          problem({
            file: file.path,
            message: issue.message,
            ...(issue.line ? { line: issue.line } : {}),
          });
      }
      for (const doc of diff.documents) {
        const object = label(doc.kind, doc.name);
        for (const f of doc.newFindings) keep({ ...pick(f), file: file.path, object });
        if (doc.status === 'changed' || (doc.status === 'added' && file.base !== null)) {
          result.changes.push(toChange(file.path, object, doc));
        }
      }
    } else {
      for (const doc of checkManifest(file.text, rules).documents) {
        const object = label(doc.kind, doc.name);
        for (const issue of doc.issues)
          problem({
            file: file.path,
            message: issue.message,
            ...(issue.line ? { line: issue.line } : {}),
          });
        for (const f of doc.findings) keep({ ...pick(f), file: file.path, object });
        if (doc.coverage.level !== 'checked' && doc.coverage.message) {
          result.notChecked.push({
            file: file.path,
            line: doc.startLine,
            object,
            level: doc.coverage.level,
            message: doc.coverage.message,
            ...(doc.kind !== undefined ? { kind: doc.kind } : {}),
            ...(doc.apiVersion !== undefined ? { apiVersion: doc.apiVersion } : {}),
          });
        }
      }
    }
  }

  result.findings.sort(
    (a, b) =>
      ORDER[a.severity] - ORDER[b.severity] ||
      a.file.localeCompare(b.file) ||
      a.line - b.line ||
      a.ruleId.localeCompare(b.ruleId),
  );
  return result;
}

function pick(f: {
  ruleId: string;
  severity: LocatedFinding['severity'];
  message: string;
  line: number;
  why?: string | undefined;
  fix?: string | undefined;
}) {
  return {
    ruleId: f.ruleId,
    severity: f.severity,
    message: f.message,
    line: f.line,
    ...(f.why ? { why: f.why } : {}),
    ...(f.fix ? { fix: f.fix } : {}),
  };
}

function toChange(
  file: string,
  object: string,
  doc: { status: string; notes: string[]; changes: { effect?: string | undefined }[] },
): ChangedObject {
  return {
    file,
    object,
    status: doc.status === 'added' ? 'added' : 'changed',
    notes: doc.notes,
    effects: doc.changes
      .map((c) => c.effect)
      .filter((e): e is string => Boolean(e))
      .slice(0, MAX_EFFECTS_PER_OBJECT),
  };
}
