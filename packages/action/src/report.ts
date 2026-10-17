import type { Rule, Severity } from '@manifestlens/core';
import type { Base } from './base.js';
import type { Verdict } from './evaluate.js';
import { thresholds } from './settings.js';
import type { Analysis, LocatedFinding, SettingKey, Settings, Source } from './types.js';

export interface RunInfo {
  version: string;
  settings: Settings;
  sources: Record<SettingKey, Source>;
  configPath: string | null;
  base: Base | null;
  analysis: Analysis;
  verdict: Verdict;
  rules: Rule[];
  matchedFiles: number;
  skipped: { path: string; reason: string }[];
}

const REPO_URL = 'https://github.com/prsurve/manifestlens';
const MAX_SUMMARY_ROWS = 300;
const MAX_COMMENT_ROWS = 15;
const MAX_COMMENT_CHARS = 60000;

const ICON: Record<Severity, string> = { error: '🔴', warning: '🟠', info: '🔵' };

/** Text from manifests is untrusted: stop it breaking tables or injecting HTML. */
export function md(text: string): string {
  return text
    .replace(/[\r\n]+/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\|/g, '\\|');
}

const code = (text: string): string => `<code>${md(text)}</code>`;
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

function headline(info: RunInfo): string {
  const { verdict: v, analysis: a } = info;
  const counts = `${plural(v.counts.error, 'error')}, ${plural(v.counts.warning, 'warning')}, ${plural(v.counts.info, 'info finding')} in ${plural(a.filesChecked, 'file')}`;
  switch (v.result) {
    case 'pass':
      return `✅ **Passed**: ${counts}.`;
    case 'fail':
      return `❌ **Failed**: ${counts}.`;
    case 'report':
      return `⚠️ **Rules violated, not blocking** (mode: report): ${counts}.`;
    case 'dry-run':
      return `🧪 **Dry run**: ${counts}. Nothing was posted and the build was not affected.`;
  }
}

function scopeLine(info: RunInfo): string {
  const s = info.settings;
  if (s.scope === 'all') return 'Scope: every finding in the matched files.';
  const base = info.base
    ? `compared with ${code(info.base.ref.slice(0, 12))} (${md(info.base.source)})`
    : '';
  return s.scope === 'changed'
    ? `Scope: files this change touches, ${base}.`
    : `Scope: only findings this change introduces, ${base}. Existing findings are not counted.`;
}

function allowed(max: number | null): string {
  return max === null ? 'any' : String(max);
}

function findingRows(findings: LocatedFinding[], limit: number): string[] {
  return findings
    .slice(0, limit)
    .map(
      (f) =>
        `| ${ICON[f.severity]} ${f.severity} | ${code(`${f.file}:${f.line}`)} | ${code(f.ruleId)} | ${md(f.message)} |`,
    );
}

const TABLE_HEAD = ['| Severity | Where | Rule | Message |', '| --- | --- | --- | --- |'];

/** The full job summary, as markdown. */
export function buildSummary(info: RunInfo): string {
  const { analysis: a, verdict: v, settings: s } = info;
  const limit = thresholds(s);
  const out: string[] = [
    `## ManifestLens${s.label ? ` · ${md(s.label)}` : ''}`,
    '',
    `> ${headline(info)}`,
    '',
  ];

  if (v.reasons.length > 0) {
    out.push(...v.reasons.map((r) => `- ${md(r)}`), '');
  }
  out.push(
    '| Severity | Found | Allowed |',
    '| --- | ---: | ---: |',
    `| 🔴 error | ${v.counts.error} | ${allowed(limit.error)} |`,
    `| 🟠 warning | ${v.counts.warning} | ${allowed(limit.warning)} |`,
    `| 🔵 info | ${v.counts.info} | ${allowed(limit.info)} |`,
    `| **total** | **${v.counts.total}** | ${allowed(limit.total)} |`,
    '',
    scopeLine(info),
    `Checked ${plural(a.filesChecked, 'manifest file')} with ${plural(info.rules.length, 'rule')}${a.suppressed ? `; ${plural(a.suppressed, 'finding')} suppressed by ignores` : ''}.`,
    '',
  );

  if (a.parseProblems.length > 0) {
    out.push('### Manifests that could not be read', '');
    out.push(
      ...a.parseProblems
        .slice(0, 50)
        .map((p) => `- ${code(`${p.file}${p.line ? `:${p.line}` : ''}`)} ${md(p.message)}`),
      '',
    );
  }

  if (a.findings.length > 0) {
    out.push(
      `### Findings (${a.findings.length})`,
      '',
      ...TABLE_HEAD,
      ...findingRows(a.findings, MAX_SUMMARY_ROWS),
    );
    if (a.findings.length > MAX_SUMMARY_ROWS) {
      out.push(
        '',
        `_Showing the first ${MAX_SUMMARY_ROWS} of ${a.findings.length}. The full list is in the report file and the annotations._`,
      );
    }
    out.push('', ...howToFix(a.findings), '');
  }

  if (a.changes.length > 0) {
    out.push('### What this change does', '');
    for (const c of a.changes.slice(0, 40)) {
      out.push(`- **${md(c.object)}** (${code(c.file)}), ${c.status}`);
      for (const note of c.notes) out.push(`  - ${md(note)}`);
      for (const effect of c.effects) out.push(`  - ${md(effect)}`);
    }
    out.push('');
  }

  if (a.unknownRules.length > 0) {
    out.push(
      `> ⚠️ These rule ids in your settings match no rule, check for typos: ${a.unknownRules.map(code).join(', ')}.`,
      '',
    );
  }
  if (info.skipped.length > 0) {
    out.push(
      `> ${plural(info.skipped.length, 'file')} skipped (${[...new Set(info.skipped.map((x) => x.reason))].map(md).join('; ')}).`,
      '',
    );
  }
  out.push(
    configurationTable(info),
    '',
    `<sub>ManifestLens ${md(info.version)} · <a href="${REPO_URL}">${REPO_URL.replace('https://', '')}</a></sub>`,
  );
  return out.join('\n');
}

/** One entry per rule that fired, so the fix is not repeated for every finding. */
function howToFix(findings: LocatedFinding[]): string[] {
  const seen = new Map<string, LocatedFinding>();
  for (const f of findings) if (!seen.has(f.ruleId)) seen.set(f.ruleId, f);
  const lines = ['<details><summary>How to fix</summary>', ''];
  for (const f of seen.values()) {
    lines.push(
      `- ${code(f.ruleId)}${f.why ? `: ${md(f.why)}` : ''}${f.fix ? ` **Fix:** ${md(f.fix)}` : ''}`,
    );
  }
  lines.push('', '</details>');
  return lines;
}

function configurationTable(info: RunInfo): string {
  const s = info.settings;
  const value = (key: SettingKey): string => {
    const v = s[key];
    if (Array.isArray(v))
      return v.length === 0
        ? '(none)'
        : v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(', ');
    if (v !== null && typeof v === 'object')
      return Object.keys(v).length === 0 ? '(none)' : JSON.stringify(v);
    return v === null || v === '' ? '(default)' : String(v);
  };
  const keys: SettingKey[] = [
    'scope',
    'failOn',
    'maxErrors',
    'maxWarnings',
    'maxInfo',
    'maxTotal',
    'mode',
    'dryRun',
    'paths',
    'disableRules',
    'severityOverrides',
    'ignore',
  ];
  const rows = keys.map((k) => `| ${code(k)} | ${code(value(k))} | ${info.sources[k]} |`);
  return [
    '<details><summary>Configuration used</summary>',
    '',
    `Precedence: built-in defaults, then ${info.configPath ? code(info.configPath) : 'the config file (none found)'}, then workflow inputs.`,
    '',
    '| Setting | Value | From |',
    '| --- | --- | --- |',
    ...rows,
    '',
    '</details>',
  ].join('\n');
}

/** A shorter version for a pull request comment. `marker` lets the next run find and update it. */
export function buildComment(info: RunInfo, marker: string, runUrl: string | null): string {
  const { analysis: a, verdict: v, settings: s } = info;
  const out: string[] = [
    marker,
    `### ManifestLens${s.label ? ` · ${md(s.label)}` : ''}`,
    '',
    headline(info),
    '',
  ];
  if (v.reasons.length > 0) out.push(...v.reasons.map((r) => `- ${md(r)}`), '');
  if (a.findings.length > 0) {
    out.push(...TABLE_HEAD, ...findingRows(a.findings, MAX_COMMENT_ROWS));
    if (a.findings.length > MAX_COMMENT_ROWS)
      out.push('', `_…and ${a.findings.length - MAX_COMMENT_ROWS} more._`);
    out.push('');
  }
  if (a.changes.length > 0) {
    out.push('**What this change does**', '');
    for (const c of a.changes.slice(0, 10))
      out.push(`- **${md(c.object)}**: ${md([...c.notes, ...c.effects][0] ?? c.status)}`);
    out.push('');
  }
  out.push(runUrl ? `[Full report and how to fix](${runUrl})` : '');
  return out.join('\n').slice(0, MAX_COMMENT_CHARS);
}

const LEVEL = { error: 'error', warning: 'warning', info: 'note' } as const;

/** SARIF 2.1.0, for GitHub code scanning (`github/codeql-action/upload-sarif`). */
export function buildSarif(info: RunInfo): object {
  const a = info.analysis;
  const used = new Set(a.findings.map((f) => f.ruleId));
  const rules = info.rules
    .filter((r) => used.has(r.id))
    .map((r) => ({
      id: r.id,
      name: r.id,
      shortDescription: { text: r.title },
      ...(r.why || r.fix
        ? { help: { text: [r.why, r.fix && `Fix: ${r.fix}`].filter(Boolean).join(' ') } }
        : {}),
      defaultConfiguration: { level: LEVEL[r.severity] },
    }));
  const location = (file: string, line: number | undefined) => ({
    physicalLocation: {
      artifactLocation: { uri: file },
      region: { startLine: Math.max(line ?? 1, 1) },
    },
  });
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: { name: 'ManifestLens', version: info.version, informationUri: REPO_URL, rules },
        },
        results: [
          ...a.findings.map((f) => ({
            ruleId: f.ruleId,
            level: LEVEL[f.severity],
            message: { text: f.message },
            locations: [location(f.file, f.line)],
          })),
          ...a.parseProblems.map((p) => ({
            ruleId: 'yaml-syntax',
            level: 'error',
            message: { text: p.message },
            locations: [location(p.file, p.line)],
          })),
        ],
      },
    ],
  };
}

/** The machine-readable report that downstream steps can read. */
export function buildReport(info: RunInfo): object {
  const { analysis: a, verdict: v, settings: s } = info;
  return {
    version: info.version,
    result: v.result,
    passed: v.passed,
    reasons: v.reasons,
    counts: v.counts,
    thresholds: thresholds(s),
    scope: s.scope,
    base: info.base,
    filesChecked: a.filesChecked,
    suppressed: a.suppressed,
    findings: a.findings,
    parseProblems: a.parseProblems,
    changes: a.changes,
    sources: info.sources,
  };
}
