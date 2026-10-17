import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/evaluate.js';
import { DEFAULTS } from '../src/settings.js';
import type { Analysis, LocatedFinding, Settings } from '../src/types.js';

const finding = (severity: LocatedFinding['severity'], n = 0): LocatedFinding => ({
  file: 'a.yaml',
  line: n + 1,
  ruleId: `rule-${severity}-${n}`,
  severity,
  message: 'm',
});
const analysis = (counts: {
  error?: number;
  warning?: number;
  info?: number;
  parse?: number;
}): Analysis => ({
  findings: [
    ...Array.from({ length: counts.error ?? 0 }, (_, i) => finding('error', i)),
    ...Array.from({ length: counts.warning ?? 0 }, (_, i) => finding('warning', i)),
    ...Array.from({ length: counts.info ?? 0 }, (_, i) => finding('info', i)),
  ],
  parseProblems: Array.from({ length: counts.parse ?? 0 }, () => ({
    file: 'a.yaml',
    message: 'bad',
  })),
  suppressed: 0,
  filesChecked: 1,
  changes: [],
  unknownRules: [],
});
const s = (patch: Partial<Settings> = {}): Settings => ({ ...DEFAULTS, ...patch });

describe('evaluate: success criteria', () => {
  it('passes a clean run', () => {
    const v = evaluate(analysis({}), s());
    expect(v).toMatchObject({ passed: true, result: 'pass', blocking: false, reasons: [] });
  });

  it('fails on any error by default, and says why', () => {
    const v = evaluate(analysis({ error: 2 }), s());
    expect(v).toMatchObject({ passed: false, result: 'fail', blocking: true });
    expect(v.reasons).toEqual(['2 errors found, none allowed.']);
  });

  it('ignores warnings and info by default', () => {
    expect(evaluate(analysis({ warning: 5, info: 9 }), s()).passed).toBe(true);
  });

  it('fails on warnings when fail-on is warning', () => {
    expect(evaluate(analysis({ warning: 1 }), s({ failOn: 'warning' })).result).toBe('fail');
    expect(evaluate(analysis({ info: 1 }), s({ failOn: 'warning' })).result).toBe('pass');
    expect(evaluate(analysis({ info: 1 }), s({ failOn: 'info' })).result).toBe('fail');
  });

  it('never fails on findings when fail-on is none', () => {
    expect(evaluate(analysis({ error: 9, warning: 9 }), s({ failOn: 'none' })).result).toBe('pass');
  });

  it('allows up to a threshold and fails above it', () => {
    const settings = s({ failOn: 'warning', maxWarnings: 3 });
    expect(evaluate(analysis({ warning: 3 }), settings).passed).toBe(true);
    const over = evaluate(analysis({ warning: 4 }), settings);
    expect(over.passed).toBe(false);
    expect(over.reasons).toEqual(['4 warnings found, at most 3 allowed.']);
  });

  it('enforces the total across severities', () => {
    const v = evaluate(analysis({ warning: 2, info: 2 }), s({ maxTotal: 3 }));
    expect(v.reasons).toEqual(['4 findings in total, at most 3 allowed.']);
    expect(evaluate(analysis({ warning: 2, info: 1 }), s({ maxTotal: 3 })).passed).toBe(true);
  });

  it('reports every violated rule, singular and plural', () => {
    const v = evaluate(analysis({ error: 1, warning: 1 }), s({ failOn: 'warning' }));
    expect(v.reasons).toEqual(['1 error found, none allowed.', '1 warning found, none allowed.']);
  });

  it('fails on unreadable manifests unless told not to', () => {
    expect(evaluate(analysis({ parse: 1 }), s()).reasons[0]).toContain('1 manifest problem');
    expect(evaluate(analysis({ parse: 2 }), s({ failOnParseError: false })).passed).toBe(true);
  });

  it('counts findings by severity', () => {
    expect(evaluate(analysis({ error: 1, warning: 2, info: 3, parse: 4 }), s()).counts).toEqual({
      error: 1,
      warning: 2,
      info: 3,
      total: 6,
      parseErrors: 4,
    });
  });
});

describe('evaluate: modes that do not block', () => {
  it('report mode states the violation but does not block', () => {
    const v = evaluate(analysis({ error: 1 }), s({ mode: 'report' }));
    expect(v).toMatchObject({ passed: false, result: 'report', blocking: false });
    expect(v.reasons).toHaveLength(1);
  });

  it('dry-run never blocks, even in enforce mode', () => {
    const v = evaluate(analysis({ error: 1 }), s({ dryRun: true }));
    expect(v).toMatchObject({ passed: false, result: 'dry-run', blocking: false });
  });

  it('a passing run is a pass in every mode', () => {
    for (const patch of [{ mode: 'report' as const }, { dryRun: true }, {}]) {
      expect(evaluate(analysis({}), s(patch)).result).toBe('pass');
    }
  });
});
