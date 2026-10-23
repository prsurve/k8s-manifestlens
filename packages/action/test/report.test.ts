import { loadBundledRules } from '@manifestlens/core';
import { describe, expect, it } from 'vitest';
import { analyze } from '../src/analyze.js';
import { evaluate } from '../src/evaluate.js';
import { buildComment, buildReport, buildSarif, buildSummary, md } from '../src/report.js';
import type { RunInfo } from '../src/report.js';
import { DEFAULTS, resolveSettings } from '../src/settings.js';
import type { Analysis, LocatedFinding, Settings } from '../src/types.js';
import { example } from './helpers.js';

const rules = loadBundledRules();
/** A row of the findings table: it names a file and line, unlike a row of the by-rule table. */
const isFindingRow = (line: string): boolean =>
  /^\| (🔴|🟠|🔵) \w+ \| <code>[^<]*:\d+<\/code> \|/.test(line);

function info(
  text: string,
  patch: Partial<Settings> = {},
  overrides: Partial<Analysis> = {},
): RunInfo {
  const { settings, sources } = resolveSettings({}, patch);
  const analysis = { ...analyze([{ path: 'k8s/app.yaml', text }], rules, settings), ...overrides };
  return {
    version: '9.9.9',
    settings,
    sources,
    configPath: null,
    base: null,
    analysis,
    verdict: evaluate(analysis, settings),
    rules,
    matchedFiles: 1,
    skipped: [],
  };
}

describe('md: untrusted text', () => {
  it('stops text breaking tables or injecting HTML', () => {
    expect(md('a | b\n<img src=x onerror=alert(1)> & more')).toBe(
      'a \\| b &lt;img src=x onerror=alert(1)&gt; &amp; more',
    );
  });
});

describe('job summary', () => {
  const failed = buildSummary(info(example('risky.yaml')));

  it('leads with the verdict and the counts', () => {
    expect(failed).toContain('## ManifestLens');
    expect(failed).toMatch(
      /> ❌ \*\*Failed\*\*: 2 errors, 9 warnings, 7 info findings in 1 file\./,
    );
    expect(failed).toContain('- 2 errors found, none allowed.');
  });

  it('shows found against allowed for each severity', () => {
    expect(failed).toContain('| 🔴 error | 2 | 0 |');
    expect(failed).toContain('| 🟠 warning | 9 | any |');
    expect(failed).toContain('| **total** | **18** | any |');
  });

  it('lists findings with where, rule and message, and how to fix each rule once', () => {
    expect(failed).toContain(
      '| 🔴 error | <code>k8s/app.yaml:17</code> | <code>privileged-container</code> |',
    );
    expect(failed).toContain('<summary>How to fix</summary>');
    expect(failed.match(/<code>image-latest-tag<\/code>: /g)).toHaveLength(1);
    expect(failed).toContain('**Fix:**');
  });

  it('records which level each setting came from', () => {
    const text = buildSummary(info(example('risky.yaml'), { failOn: 'warning' }));
    expect(text).toContain(
      'Precedence: built-in defaults, then the config file (none found), then workflow inputs.',
    );
    expect(text).toMatch(/<code>failOn<\/code> \| <code>warning<\/code> \| input/);
    expect(text).toMatch(/<code>scope<\/code> \| <code>all<\/code> \| default/);
  });

  it('says so plainly when everything passes', () => {
    const ok = buildSummary(info(example('hardened.yaml')));
    expect(ok).toContain('✅ **Passed**');
    expect(ok).not.toContain('### Findings');
  });

  it('words each non-blocking mode differently', () => {
    expect(buildSummary(info(example('risky.yaml'), { mode: 'report' }))).toContain(
      'Rules violated, not blocking',
    );
    expect(buildSummary(info(example('risky.yaml'), { dryRun: true }))).toContain('Dry run');
  });

  it('puts the label in the heading so matrix jobs can be told apart', () => {
    expect(buildSummary(info(example('hardened.yaml'), { label: 'prod / eu' }))).toContain(
      '## ManifestLens · prod / eu',
    );
  });

  it('truncates a very long list and says so', () => {
    const many: LocatedFinding[] = Array.from({ length: 400 }, (_, i) => ({
      file: 'a.yaml',
      line: i + 1,
      ruleId: 'r',
      severity: 'info',
      message: 'm',
    }));
    const text = buildSummary(info(example('hardened.yaml'), {}, { findings: many }));
    expect(text).toContain('Showing the first 300 of 400');
    expect(text.split('\n').filter(isFindingRow)).toHaveLength(300);
  });

  it('escapes hostile text from manifests', () => {
    const hostile: LocatedFinding = {
      file: 'a|b.yaml',
      line: 1,
      ruleId: 'r',
      severity: 'error',
      message: '<script>alert(1)</script> | x',
    };
    const text = buildSummary(info(example('hardened.yaml'), {}, { findings: [hostile] }));
    expect(text).not.toContain('<script>');
    expect(text).toContain('&lt;script&gt;alert(1)&lt;/script&gt; \\| x');
  });

  it('warns about rule ids that match nothing, and about skipped files', () => {
    const run = info(example('hardened.yaml'), {}, { unknownRules: ['typo-rule'] });
    run.skipped = [{ path: 'big.yaml', reason: 'larger than max-file-size-kb (1024)' }];
    const text = buildSummary(run);
    expect(text).toContain('<code>typo-rule</code>');
    expect(text).toContain('1 file skipped (larger than max-file-size-kb (1024))');
  });

  it('explains the scope', () => {
    const run = info(example('hardened.yaml'), { scope: 'new' });
    run.base = { ref: 'abcdef1234567890', source: 'the pull request base' };
    expect(buildSummary(run)).toContain(
      'only findings this change introduces, compared with <code>abcdef123456</code>',
    );
  });

  it('describes what a change does', () => {
    const run = info(
      example('hardened.yaml'),
      { scope: 'new' },
      {
        changes: [
          {
            file: 'd.yaml',
            object: 'Deployment "web"',
            status: 'changed',
            notes: ['rolling update'],
            effects: ['Scales up from 2 to 5'],
          },
        ],
      },
    );
    const text = buildSummary(run);
    expect(text).toContain('### What this change does');
    expect(text).toContain('Scales up from 2 to 5');
  });
});

describe('by-rule breakdown', () => {
  const lots: LocatedFinding[] = [
    ...Array.from({ length: 7 }, (_, i): LocatedFinding => ({
      file: `a${i}.yaml`,
      line: 1,
      ruleId: 'common-warning',
      severity: 'warning',
      message: 'm',
    })),
    ...Array.from({ length: 3 }, (_, i): LocatedFinding => ({
      file: `b${i}.yaml`,
      line: 1,
      ruleId: 'rare-warning',
      severity: 'warning',
      message: 'm',
    })),
    ...Array.from({ length: 5 }, (_, i): LocatedFinding => ({
      file: `c${i}.yaml`,
      line: 1,
      ruleId: 'common-info',
      severity: 'info',
      message: 'm',
    })),
    { file: 'd.yaml', line: 1, ruleId: 'the-error', severity: 'error', message: 'm' },
  ];
  const run = () => info(example('hardened.yaml'), {}, { findings: lots });

  it('counts findings per rule in the summary, most severe and most common first', () => {
    const text = buildSummary(run());
    const section = text.split('### By rule')[1]?.split('###')[0] ?? '';
    const rows = section
      .split('\n')
      .filter((l) => l.startsWith('| ') && !l.startsWith('| Severity') && !l.startsWith('| ---'));
    expect(rows).toEqual([
      '| 🔴 error | <code>the-error</code> | 1 |',
      '| 🟠 warning | <code>common-warning</code> | 7 |',
      '| 🟠 warning | <code>rare-warning</code> | 3 |',
      '| 🔵 info | <code>common-info</code> | 5 |',
    ]);
  });

  it('puts it before the long list of findings', () => {
    const text = buildSummary(run());
    expect(text.indexOf('### By rule')).toBeGreaterThan(-1);
    expect(text.indexOf('### By rule')).toBeLessThan(text.indexOf('### Findings'));
  });

  it('is also in the pull request comment, ahead of the first rows', () => {
    const body = buildComment(run(), '<!-- m -->', null);
    expect(body).toContain('**By rule**');
    expect(body.indexOf('**By rule**')).toBeLessThan(body.indexOf('| Severity | Where |'));
    expect(body).toContain('| 🟠 warning | <code>common-warning</code> | 7 |');
  });

  it('is left out when the list is short enough to read in full', () => {
    expect(
      buildSummary(info(example('hardened.yaml'), {}, { findings: lots.slice(0, 4) })),
    ).not.toContain('### By rule');
    expect(
      buildComment(
        info(example('hardened.yaml'), {}, { findings: lots.slice(0, 4) }),
        '<!-- m -->',
        null,
      ),
    ).not.toContain('**By rule**');
  });

  it('shows at most the first 25 rules and says how many more there are', () => {
    const wide: LocatedFinding[] = Array.from({ length: 40 }, (_, i) => ({
      file: 'a.yaml',
      line: i + 1,
      ruleId: `rule-${String(i).padStart(2, '0')}`,
      severity: 'info',
      message: 'm',
    }));
    const text = buildSummary(info(example('hardened.yaml'), {}, { findings: wide }));
    expect((text.match(/\| 🔵 info \| <code>rule-/g) ?? []).length).toBe(25);
    expect(text).toContain('and 15 more rules');
  });

  it('says "1 more rule" when exactly one rule is left out', () => {
    const rules = (n: number): LocatedFinding[] =>
      Array.from({ length: n }, (_, i) => ({
        file: 'a.yaml',
        line: i + 1,
        ruleId: `rule-${String(i).padStart(2, '0')}`,
        severity: 'info',
        message: 'm',
      }));
    const summary = buildSummary(info(example('hardened.yaml'), {}, { findings: rules(26) }));
    expect(summary).toContain('and 1 more rule.');
    expect(summary).not.toContain('1 more rules');
    const comment = buildComment(
      info(example('hardened.yaml'), {}, { findings: rules(11) }),
      '<!-- m -->',
      null,
    );
    expect(comment).toContain('and 1 more rule.');
    expect(comment).not.toContain('1 more rules');
  });

  it('escapes rule ids', () => {
    const bad: LocatedFinding[] = Array.from({ length: 12 }, () => ({
      file: 'a.yaml',
      line: 1,
      ruleId: '<b>x</b>',
      severity: 'info',
      message: 'm',
    }));
    expect(buildSummary(info(example('hardened.yaml'), {}, { findings: bad }))).not.toContain(
      '<b>x</b>',
    );
  });
});

describe('pull request comment', () => {
  const marker = '<!-- manifestlens-action:prod -->';

  it('starts with the marker so the next run can update it, and links the full report', () => {
    const body = buildComment(
      info(example('risky.yaml'), { label: 'prod' }),
      marker,
      'https://github.com/o/r/actions/runs/1',
    );
    expect(body.split('\n')[0]).toBe(marker);
    expect(body).toContain('[Full report and how to fix](https://github.com/o/r/actions/runs/1)');
  });

  it('shows only the first findings and counts the rest', () => {
    const body = buildComment(info(example('risky.yaml')), marker, null);
    expect(body.split('\n').filter(isFindingRow)).toHaveLength(15);
    expect(body).toContain('…and 3 more.');
  });

  it('stays under the comment size limit', () => {
    const many: LocatedFinding[] = Array.from({ length: 5 }, () => ({
      file: 'a.yaml',
      line: 1,
      ruleId: 'r',
      severity: 'info',
      message: 'x'.repeat(30000),
    }));
    expect(
      buildComment(info(example('hardened.yaml'), {}, { findings: many }), marker, null).length,
    ).toBeLessThanOrEqual(60000);
  });
});

describe('SARIF', () => {
  const sarif = buildSarif(
    info(
      example('risky.yaml'),
      {},
      { parseProblems: [{ file: 'bad.yaml', line: 3, message: 'oops' }] },
    ),
  ) as {
    version: string;
    runs: {
      tool: {
        driver: {
          name: string;
          version: string;
          rules: { id: string; shortDescription: { text: string } }[];
        };
      };
      results: {
        ruleId: string;
        level: string;
        locations: {
          physicalLocation: { artifactLocation: { uri: string }; region: { startLine: number } };
        }[];
      }[];
    }[];
  };
  const run = sarif.runs[0] as (typeof sarif.runs)[number];

  it('is a SARIF 2.1.0 document from this tool', () => {
    expect(sarif.version).toBe('2.1.0');
    expect(run.tool.driver).toMatchObject({ name: 'ManifestLens', version: '9.9.9' });
  });

  it('has one result per finding with the right level and location', () => {
    expect(run.results).toHaveLength(19);
    const priv = run.results.find((r) => r.ruleId === 'privileged-container');
    expect(priv).toMatchObject({ level: 'error' });
    expect(priv?.locations[0]?.physicalLocation).toEqual({
      artifactLocation: { uri: 'k8s/app.yaml' },
      region: { startLine: 17 },
    });
    expect(run.results.find((r) => r.ruleId === 'single-replica')?.level).toBe('note');
    expect(run.results.find((r) => r.ruleId === 'image-latest-tag')?.level).toBe('warning');
  });

  it('describes only the rules that fired, once each, and reports unreadable YAML', () => {
    const rulesUsed = run.tool.driver.rules.map((r) => r.id);
    expect(new Set(rulesUsed).size).toBe(rulesUsed.length);
    expect(rulesUsed).toContain('privileged-container');
    expect(rulesUsed).not.toContain('hostpath-volume-unused');
    expect(
      run.tool.driver.rules.find((r) => r.id === 'privileged-container')?.shortDescription.text,
    ).toBe('Container runs in privileged mode');
    expect(run.results.find((r) => r.ruleId === 'yaml-syntax')).toMatchObject({ level: 'error' });
  });
});

describe('JSON report', () => {
  it('has what a downstream step needs', () => {
    const report = buildReport(info(example('risky.yaml'), { failOn: 'warning' })) as Record<
      string,
      unknown
    >;
    expect(report).toMatchObject({
      version: '9.9.9',
      result: 'fail',
      passed: false,
      counts: { error: 2, warning: 9, info: 7, total: 18 },
      thresholds: { error: 0, warning: 0, info: null, total: null },
      scope: 'all',
      filesChecked: 1,
    });
    expect((report.findings as unknown[]).length).toBe(18);
    expect(Object.keys(report)).toEqual(
      expect.arrayContaining(['reasons', 'sources', 'parseProblems', 'changes']),
    );
  });
});

it('keeps DEFAULTS unmodified by resolving settings', () => {
  resolveSettings({}, { failOn: 'info', paths: ['x'] });
  expect(DEFAULTS.failOn).toBe('error');
  expect(DEFAULTS.paths).toEqual(['**/*.yaml', '**/*.yml']);
});
