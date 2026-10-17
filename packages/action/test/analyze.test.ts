import { loadBundledRules } from '@manifestlens/core';
import { describe, expect, it } from 'vitest';
import { analyze, prepareRules } from '../src/analyze.js';
import { DEFAULTS } from '../src/settings.js';
import type { Settings } from '../src/types.js';
import { example } from './helpers.js';

const rules = loadBundledRules();
const s = (patch: Partial<Settings> = {}): Settings => ({ ...DEFAULTS, ...patch });
const risky = example('risky.yaml');
const hardened = example('hardened.yaml');
const ids = (a: ReturnType<typeof analyze>) => a.findings.map((f) => f.ruleId);

describe('analyze: all findings', () => {
  it('finds every problem with its file, line and object, most severe first', () => {
    const a = analyze([{ path: 'k8s/risky.yaml', text: risky }], rules, s());
    expect(a.findings).toHaveLength(16);
    expect(a.filesChecked).toBe(1);
    expect(a.findings.map((f) => f.severity).slice(0, 2)).toEqual(['error', 'error']);
    expect(a.findings[0]).toMatchObject({
      file: 'k8s/risky.yaml',
      ruleId: 'privileged-container',
      line: 17,
      object: 'Deployment "risky"',
    });
    expect(a.findings[0]?.fix).toBeTruthy();
  });

  it('finds nothing in a hardened manifest', () => {
    expect(analyze([{ path: 'h.yaml', text: hardened }], rules, s()).findings).toEqual([]);
  });

  it('reports YAML that cannot be read, with the file and line', () => {
    const a = analyze(
      [{ path: 'bad.yaml', text: 'apiVersion: v1\nkind: Pod\nspec: [oops\n' }],
      rules,
      s(),
    );
    expect(a.parseProblems).toHaveLength(1);
    expect(a.parseProblems[0]).toMatchObject({ file: 'bad.yaml' });
    expect(a.parseProblems[0]?.line).toBeGreaterThan(0);
  });
});

describe('analyze: rule settings', () => {
  it('turns rules off', () => {
    const a = analyze(
      [{ path: 'r.yaml', text: risky }],
      rules,
      s({ disableRules: ['image-latest-tag', 'single-replica'] }),
    );
    expect(ids(a)).not.toContain('image-latest-tag');
    expect(ids(a)).not.toContain('single-replica');
    expect(a.findings).toHaveLength(14);
  });

  it('changes a rule severity, or switches it off', () => {
    const a = analyze(
      [{ path: 'r.yaml', text: risky }],
      rules,
      s({
        severityOverrides: {
          'image-latest-tag': 'error',
          'single-replica': 'off',
          'privileged-container': 'info',
        },
      }),
    );
    expect(a.findings.find((f) => f.ruleId === 'image-latest-tag')?.severity).toBe('error');
    expect(a.findings.find((f) => f.ruleId === 'privileged-container')?.severity).toBe('info');
    expect(ids(a)).not.toContain('single-replica');
  });

  it('names rule ids that match no rule', () => {
    const { unknown } = prepareRules(
      rules,
      s({
        disableRules: ['image-latest-tagg'],
        severityOverrides: { nope: 'off' },
        ignore: [{ rules: ['also-nope', 'all'] }],
      }),
    );
    expect(unknown.sort()).toEqual(['also-nope', 'image-latest-tagg', 'nope']);
  });

  it('does not change the shared rule objects', () => {
    const before = rules.find((r) => r.id === 'image-latest-tag')?.severity;
    prepareRules(rules, s({ severityOverrides: { 'image-latest-tag': 'error' } }));
    expect(rules.find((r) => r.id === 'image-latest-tag')?.severity).toBe(before);
  });
});

describe('analyze: ignores', () => {
  it('silences rules for files that match a glob', () => {
    const files = [
      { path: 'k8s/app.yaml', text: risky },
      { path: 'examples/demo.yaml', text: risky },
    ];
    const a = analyze(files, rules, s({ ignore: [{ path: 'examples/**' }] }));
    expect(new Set(a.findings.map((f) => f.file))).toEqual(new Set(['k8s/app.yaml']));
    expect(a.suppressed).toBe(16);
  });

  it('silences only the named rules for a path', () => {
    const a = analyze(
      [{ path: 'jobs/x.yaml', text: risky }],
      rules,
      s({
        ignore: [{ path: 'jobs/**', rules: ['missing-readiness-probe', 'missing-liveness-probe'] }],
      }),
    );
    expect(ids(a)).not.toContain('missing-readiness-probe');
    expect(ids(a)).toContain('image-latest-tag');
    expect(a.suppressed).toBe(2);
  });

  it('silences a rule everywhere when no path is given', () => {
    const a = analyze(
      [{ path: 'a.yaml', text: risky }],
      rules,
      s({ ignore: [{ rules: ['image-latest-tag'] }] }),
    );
    expect(ids(a)).not.toContain('image-latest-tag');
  });

  it('honours an inline comment on the same line', () => {
    const text = risky.replace(
      'image: nginx',
      'image: nginx # manifestlens-ignore: image-latest-tag',
    );
    const a = analyze([{ path: 'a.yaml', text }], rules, s());
    expect(ids(a)).not.toContain('image-latest-tag');
    expect(a.suppressed).toBe(1);
  });

  it('honours an inline comment on the comment line above, for several rules or all', () => {
    const above = risky.replace(
      '      - name: app',
      '      # manifestlens-ignore: missing-memory-limit, missing-readiness-probe\n      - name: app',
    );
    // the container finding lines now point one line lower; the comment sits directly above them
    const a = analyze([{ path: 'a.yaml', text: above }], rules, s());
    expect(ids(a)).not.toContain('missing-memory-limit');
    expect(ids(a)).not.toContain('missing-readiness-probe');

    const all = risky.replace('privileged: true', 'privileged: true # manifestlens-ignore: all');
    expect(ids(analyze([{ path: 'a.yaml', text: all }], rules, s()))).not.toContain(
      'privileged-container',
    );
  });

  it('does not let a comment elsewhere, or for another rule, silence a finding', () => {
    const elsewhere = risky.replace(
      'kind: Service',
      'kind: Service # manifestlens-ignore: image-latest-tag',
    );
    expect(ids(analyze([{ path: 'a.yaml', text: elsewhere }], rules, s()))).toContain(
      'image-latest-tag',
    );
    const other = risky.replace(
      'image: nginx',
      'image: nginx # manifestlens-ignore: some-other-rule',
    );
    expect(ids(analyze([{ path: 'a.yaml', text: other }], rules, s()))).toContain(
      'image-latest-tag',
    );
  });
});

describe('analyze: scope new (only what this change introduces)', () => {
  const newScope = s({ scope: 'new' });

  it('reports nothing when the file did not change', () => {
    const a = analyze([{ path: 'r.yaml', text: risky, base: risky }], rules, newScope);
    expect(a.findings).toEqual([]);
    expect(a.changes).toEqual([]);
  });

  it('reports only the finding the change introduces, not the old ones', () => {
    // risky.yaml already has 16 problems. A change that touches something unrelated adds none.
    const unrelated = risky.replace(
      'hostNetwork: true',
      'hostNetwork: true\n      terminationGracePeriodSeconds: 5',
    );
    const sameProblems = analyze(
      [{ path: 'r.yaml', text: unrelated, base: risky }],
      rules,
      newScope,
    );
    expect(sameProblems.findings).toEqual([]);
    expect(sameProblems.changes).toHaveLength(1);

    // Editing a line that is still wrong counts as new: the message names the value you changed.
    const touched = risky.replace('image: nginx', 'image: nginx:latest');
    expect(ids(analyze([{ path: 'r.yaml', text: touched, base: risky }], rules, newScope))).toEqual(
      ['image-latest-tag'],
    );

    // A hardened file with a new unpinned image: exactly one new finding, and the diff explains it.
    const hardenedNow = hardened.replace(
      'image: ghcr.io/example/app:1.4.2',
      'image: ghcr.io/example/app',
    );
    const b = analyze([{ path: 'h.yaml', text: hardenedNow, base: hardened }], rules, newScope);
    expect(ids(b)).toEqual(['image-latest-tag']);
    expect(b.changes[0]?.effects.join(' ')).toContain(
      'Container "app" will run ghcr.io/example/app instead of',
    );
  });

  it('counts every finding of a file that is new in this change', () => {
    const a = analyze([{ path: 'new.yaml', text: risky, base: null }], rules, newScope);
    expect(a.findings).toHaveLength(16);
    expect(a.changes).toEqual([]);
  });

  it('describes what a change does for objects that changed', () => {
    const base =
      'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\nspec:\n  replicas: 2\n';
    const a = analyze([{ path: 'd.yaml', text: base.replace('2', '5'), base }], [], newScope);
    expect(a.changes).toHaveLength(1);
    expect(a.changes[0]).toMatchObject({
      file: 'd.yaml',
      object: 'Deployment "web"',
      status: 'changed',
    });
    expect(a.changes[0]?.effects.join(' ')).toContain('Scales up from 2 to 5');
  });

  it('reports YAML problems only from the new version', () => {
    const broken = 'apiVersion: v1\nkind: Pod\nspec: [oops\n';
    const a = analyze([{ path: 'x.yaml', text: risky, base: broken }], rules, newScope);
    expect(a.parseProblems).toEqual([]);
    const fromNew = analyze(
      [{ path: 'x.yaml', text: broken, base: risky }],
      rules,
      newScope,
    ).parseProblems;
    expect(fromNew.length).toBeGreaterThan(0);
    expect(fromNew.every((p) => p.file === 'x.yaml')).toBe(true);
  });

  it('applies ignores to new findings too', () => {
    const a = analyze(
      [{ path: 'x.yaml', text: risky, base: null }],
      rules,
      s({ scope: 'new', ignore: [{ path: 'x.yaml' }] }),
    );
    expect(a.findings).toEqual([]);
    expect(a.suppressed).toBe(16);
  });
});
