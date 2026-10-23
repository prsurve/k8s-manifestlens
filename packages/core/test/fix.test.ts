import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  RuleError,
  checkManifest,
  fixManifest,
  isStale,
  lineEdits,
  loadBundledRules,
  parseFixPolicy,
  parseManifest,
  parseRules,
  unifiedDiff,
} from '../src/index.js';
import type { FixOptions } from '../src/index.js';
import { setInSource, toSteps } from '../src/fix/edit.js';

const rules = loadBundledRules();
const example = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../examples/${name}`, import.meta.url)), 'utf8');

const POD = (security: string): string => `apiVersion: v1
kind: Pod
metadata:
  name: web
spec:
  containers:
    - name: app
      image: nginx:1.27
${security}`;

const only = (id: string, extra: FixOptions = {}): FixOptions => ({ only: [id], ...extra });

describe('setInSource', () => {
  const set = (src: string, path: string, value: unknown, doc = 0) => {
    const r = setInSource(src, doc, toSteps(path), value);
    if (!r.ok) throw new Error(r.detail);
    return r.text;
  };

  it('replaces a scalar in place and keeps the trailing comment', () => {
    const src = 'a:\n  b: true # keep me\n  c: 1\n';
    expect(set(src, 'a.b', false)).toBe('a:\n  b: false # keep me\n  c: 1\n');
  });

  it('adds a key after the last one, aligned, before the next sibling', () => {
    const src = 'a:\n  b: 1 # one\n  c: 2 # two\nz: 3\n';
    expect(set(src, 'a.d', 'x')).toBe('a:\n  b: 1 # one\n  c: 2 # two\n  d: x\nz: 3\n');
  });

  it('creates missing parents', () => {
    expect(set('a:\n  b: 1\n', 'a.c.d.e', true)).toBe('a:\n  b: 1\n  c:\n    d:\n      e: true\n');
  });

  it('adds to a map inside a list item, using the item key column', () => {
    const src = 'items:\n  - name: a\n    image: i\n  - name: b\n';
    expect(set(src, 'items[0].sec.x', true)).toBe(
      'items:\n  - name: a\n    image: i\n    sec:\n      x: true\n  - name: b\n',
    );
  });

  it('fills an empty value and an empty flow map', () => {
    expect(set('a:\n  b:\n', 'a.b.c', 1)).toBe('a:\n  b:\n    c: 1\n');
    expect(set('a:\n  b: {}\n  z: 1\n', 'a.b.c', 1)).toBe('a:\n  b:\n    c: 1\n  z: 1\n');
    expect(set('a:\n  b:\n', 'a.b', 7)).toBe('a:\n  b: 7\n');
  });

  it('writes lists as block sequences', () => {
    expect(set('a: 1\n', 'b', ['x', 'y'])).toBe('a: 1\nb:\n  - x\n  - y\n');
  });

  it('keeps CRLF line endings and a missing final newline', () => {
    expect(set('a:\r\n  b: 1\r\n', 'a.c', 2)).toBe('a:\r\n  b: 1\r\n  c: 2\r\n');
    expect(set('a:\n  b: 1', 'a.c', 2)).toBe('a:\n  b: 1\n  c: 2');
  });

  it('inserts after a trailing block scalar without eating the next key', () => {
    const src = 'a:\n  text: |\n    one\n    two\nz: 1\n';
    expect(set(src, 'a.k', 1)).toBe('a:\n  text: |\n    one\n    two\n  k: 1\nz: 1\n');
  });

  it('only touches the targeted document', () => {
    const src = 'a: 1\n---\nb:\n  c: 1\n---\nd: 2\n';
    const out = set(src, 'b.e', 3, 1);
    expect(out).toBe('a: 1\n---\nb:\n  c: 1\n  e: 3\n---\nd: 2\n');
  });

  it('adds a key inside a { flow } mapping, on the same line', () => {
    expect(set('a: { b: 1 }\n', 'a.c', true)).toBe('a: { b: 1, c: true }\n');
    expect(set('a: {b: 1}\n', 'a.c.d', 2)).toBe('a: {b: 1, c: {d: 2}}\n');
  });

  it('adds to a flow mapping inside a flow list item and keeps a trailing comment', () => {
    expect(set('l:\n  - {n: a, s: {x: 1}} # c\n', 'l[0].s.y', false)).toBe(
      'l:\n  - {n: a, s: {x: 1, y: false}} # c\n',
    );
  });

  it('puts the new key of a multi-line flow mapping on its own line', () => {
    expect(set('a: {\n  b: 1,\n  c: 2\n}\n', 'a.d', 3)).toBe('a: {\n  b: 1,\n  c: 2,\n  d: 3\n}\n');
  });

  it('fills an empty { } nested in flow style, in flow style', () => {
    expect(set('a: {n: x, s: {}}\n', 'a.s.k', true)).toBe('a: {n: x, s: {k: true}}\n');
  });

  it('edits JSON in JSON style', () => {
    expect(set('{"a": {"b": true}}', 'a.c', 'x')).toBe('{"a": {"b": true, "c": "x"}}');
    expect(set('{"a": {"b": true}}', 'a.b', false)).toBe('{"a": {"b": false}}');
    expect(set('{\n  "a": {\n    "b": 1\n  }\n}\n', 'a.c', 2)).toBe(
      '{\n  "a": {\n    "b": 1,\n    "c": 2\n  }\n}\n',
    );
  });

  it('overrides next to a merge when the value is an alias, leaving the anchor alone', () => {
    const src = 'base: &b\n  x: 1\nuse: *b\nother: *b\n';
    expect(set(src, 'use.y', 2)).toBe('base: &b\n  x: 1\nuse:\n  <<: *b\n  y: 2\nother: *b\n');
    expect(set(src, 'use.x', 9)).toBe('base: &b\n  x: 1\nuse:\n  <<: *b\n  x: 9\nother: *b\n');
    expect(set('base: &b {x: 1}\nl: {use: *b}\n', 'l.use.y', 2)).toBe(
      'base: &b {x: 1}\nl: {use: {<<: *b, y: 2}}\n',
    );
  });

  it('refuses layouts it cannot edit exactly', () => {
    const refuse = (src: string, path: string) => {
      const r = setInSource(src, 0, toSteps(path), true);
      expect(r.ok, src).toBe(false);
    };
    refuse('a: { }  # note\n', 'a.c');
    refuse('base: &x\n  b: {c: 1}\nuse: *x\n', 'use.b.d');
    refuse('base: &x\n  b: 1\nuse: *x\n', 'use');
    refuse('a: [1, 2]\n', 'a.b');
    refuse('a:\n  - 1\n', 'a[3].b');
    refuse('a:\n  b: {x: 1}\n', 'a.b');
  });
});

describe('unifiedDiff and lineEdits', () => {
  it('is empty for equal texts', () => {
    expect(unifiedDiff('a\n', 'a\n')).toBe('');
  });

  it('produces hunks with context and the right line numbers', () => {
    const a = Array.from({ length: 20 }, (_, i) => `line${i}`).join('\n') + '\n';
    const b = a.replace('line10\n', 'line10\nnew\n').replace('line2\n', 'two\n');
    const d = unifiedDiff(a, b, 'a/f', 'b/f');
    expect(d).toContain('--- a/f\n+++ b/f\n');
    expect(d).toContain('@@ -1,6 +1,6 @@');
    expect(d).toContain('-line2\n+two\n');
    expect(d).toContain('@@ -9,6 +9,7 @@');
  });

  it('marks a missing final newline', () => {
    expect(unifiedDiff('a\nb', 'a\nb\nc')).toBe(
      '--- a/manifest.yaml\n+++ b/manifest.yaml\n@@ -1,2 +1,3 @@\n a\n-b\n\\ No newline at end of file\n+b\n+c\n\\ No newline at end of file\n',
    );
  });

  it('line edits rebuild the new text from the old', () => {
    const cases: [string, string][] = [
      ['a\nb\nc\n', 'a\nX\nY\nc\nd\n'],
      ['', 'a\n'],
      ['a\n', ''],
      ['a\nb', 'a\nb\n'],
      ['x\ny\nz\n', 'z\n'],
    ];
    for (const [from, to] of cases) {
      const lines = from.match(/[^\n]*\n|[^\n]+$/g) ?? [];
      let out = '';
      let at = 0;
      for (const e of lineEdits(from, to)) {
        out += lines.slice(at, e.start).join('') + e.insert.join('');
        at = e.start + e.deleteCount;
      }
      out += lines.slice(at).join('');
      expect(out).toBe(to);
    }
  });
});

describe('fixManifest: the supported fixes', () => {
  it('sets allowPrivilegeEscalation, creating securityContext', () => {
    const r = fixManifest(POD(''), rules, only('allow-privilege-escalation'));
    expect(r.status).toBe('fixed');
    expect(r.fixed).toBe(POD('      securityContext:\n        allowPrivilegeEscalation: false\n'));
    expect(r.applied).toHaveLength(1);
    expect(r.applied[0]).toMatchObject({
      ruleId: 'allow-privilege-escalation',
      risk: 'low',
      target: { document: 0, kind: 'Pod', name: 'web', scope: 'spec.containers[0]' },
      changes: [
        {
          path: 'spec.containers[0].securityContext.allowPrivilegeEscalation',
          before: 'absent',
          after: 'false',
        },
      ],
    });
    expect(r.validation).toEqual({ ok: true, resolved: 1, introduced: [], problems: [] });
  });

  it('flips an explicit true in place', () => {
    const src = POD('      securityContext:\n        allowPrivilegeEscalation: true # tmp\n');
    const r = fixManifest(src, rules, only('allow-privilege-escalation'));
    expect(r.fixed).toBe(src.replace('true # tmp', 'false # tmp'));
    expect(r.applied[0]?.changes[0]?.before).toBe('true');
  });

  it('does not touch a privileged container, whose escalation must stay on', () => {
    const src = POD('      securityContext:\n        privileged: true\n');
    const r = fixManifest(src, rules, only('allow-privilege-escalation'));
    expect(r.status).toBe('unchanged');
    expect(r.skipped[0]).toMatchObject({ reason: 'precondition-failed' });
  });

  it('does not set runAsNonRoot when the user is root or the setting is explicitly off', () => {
    for (const sc of ['runAsUser: 0', 'runAsNonRoot: false']) {
      const r = fixManifest(
        POD(`      securityContext:\n        ${sc}\n`),
        rules,
        only('may-run-as-root'),
      );
      expect(r.status, sc).toBe('unchanged');
    }
    const podLevel = POD('').replace('spec:\n', 'spec:\n  securityContext:\n    runAsUser: 0\n');
    expect(fixManifest(podLevel, rules, only('may-run-as-root', { maxRisk: 'high' })).status).toBe(
      'unchanged',
    );
  });

  it('needs approval for medium and high risk fixes', () => {
    const src = POD('      securityContext:\n        privileged: true\n');
    const low = fixManifest(src, rules, only('privileged-container'));
    expect(low.status).toBe('unchanged');
    expect(low.skipped[0]).toMatchObject({ reason: 'risk-too-high', risk: 'high' });
    const medium = fixManifest(src, rules, only('privileged-container', { maxRisk: 'medium' }));
    expect(medium.status).toBe('unchanged');
    const high = fixManifest(src, rules, only('privileged-container', { maxRisk: 'high' }));
    expect(high.fixed).toContain('privileged: false');
  });

  it('never invents a memory limit: it needs the policy', () => {
    const none = fixManifest(POD(''), rules, only('missing-memory-limit', { maxRisk: 'medium' }));
    expect(none.status).toBe('unchanged');
    expect(none.skipped[0]).toMatchObject({ reason: 'needs-input' });
    expect(none.skipped[0]?.detail).toContain('memoryLimit');
  });

  it('applies a policy memory limit, and rejects a malformed one', () => {
    const opts = (memoryLimit: unknown): FixOptions =>
      only('missing-memory-limit', { maxRisk: 'medium', policy: { params: { memoryLimit } } });
    const ok = fixManifest(POD(''), rules, opts('256Mi'));
    expect(ok.fixed).toContain('      resources:\n        limits:\n          memory: 256Mi\n');
    for (const bad of ['512MB', '', 5, ['1Gi'].concat('x'), { a: 1 }]) {
      const r = fixManifest(POD(''), rules, opts(bad));
      expect(r.status, JSON.stringify(bad)).toBe('unchanged');
      expect(r.skipped[0]?.reason).toBe('invalid-input');
    }
  });

  it('leaves a container with a memory request alone: the limit could be below it', () => {
    const src = POD('      resources:\n        requests:\n          memory: 1Gi\n');
    const r = fixManifest(
      src,
      rules,
      only('missing-memory-limit', {
        maxRisk: 'medium',
        policy: { params: { memoryLimit: '256Mi' } },
      }),
    );
    expect(r.skipped[0]?.reason).toBe('precondition-failed');
  });

  it('adds loadBalancerSourceRanges from the policy', () => {
    const svc =
      'apiVersion: v1\nkind: Service\nmetadata:\n  name: s\nspec:\n  type: LoadBalancer\n';
    const policy = parseFixPolicy(
      'params:\n  loadBalancerSourceRanges:\n    - 10.0.0.0/8\n    - 192.168.1.0/24\n',
    );
    const r = fixManifest(
      svc,
      rules,
      only('loadbalancer-open-to-world', { maxRisk: 'medium', policy }),
    );
    expect(r.fixed).toBe(
      `${svc}  loadBalancerSourceRanges:\n    - 10.0.0.0/8\n    - 192.168.1.0/24\n`,
    );
    const bad = parseFixPolicy('params:\n  loadBalancerSourceRanges: [everyone]\n');
    expect(
      fixManifest(
        svc,
        rules,
        only('loadbalancer-open-to-world', { maxRisk: 'medium', policy: bad }),
      ).skipped[0]?.reason,
    ).toBe('invalid-input');
  });
});

describe('fixManifest: preserving the file', () => {
  const manifest = `# Web app, owned by team-a
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web   # keep
  labels: {app: web}
spec:
  template:
    spec:
      containers:
        # the main container
        - name: app
          image:   "nginx:1.27"
          securityContext: {}   
          env:
            - {name: A, value: "1"}


        - name: side
          image: busybox:1.36
          securityContext:
            runAsNonRoot: true
`;

  it('changes only what it must, byte for byte', () => {
    const r = fixManifest(manifest, rules, only('allow-privilege-escalation'));
    expect(r.status).toBe('fixed');
    // Everything outside the edited lines is identical: compare line by line.
    const before = manifest.split('\n');
    const after = r.fixed.split('\n');
    const removed = before.filter((l) => !after.includes(l));
    expect(removed).toEqual(['          securityContext: {}   ']);
    expect(r.fixed).toContain('# the main container');
    expect(r.fixed).toContain('image:   "nginx:1.27"');
    expect(r.fixed).toContain('labels: {app: web}');
  });

  it('keeps other documents byte-identical in a multi-document file', () => {
    const second =
      '---\n# second\napiVersion: v1\nkind: ConfigMap\nmetadata: {name: c}\ndata:\n  k:   "v"\n';
    const src = `${POD('')}${second}`;
    const r = fixManifest(src, rules, { maxRisk: 'medium' });
    expect(r.fixed.endsWith(second)).toBe(true);
    expect(r.fixed.startsWith('apiVersion: v1\nkind: Pod')).toBe(true);
  });

  it('fixes each document of a multi-document file independently', () => {
    const src = `${POD('')}---\n${POD('').replace('web', 'other')}`;
    const r = fixManifest(src, rules, only('allow-privilege-escalation'));
    expect(r.applied.map((a) => a.target.document)).toEqual([0, 1]);
    expect(
      checkManifest(r.fixed, rules)
        .documents.flatMap((d) => d.findings)
        .filter((f) => f.ruleId === 'allow-privilege-escalation'),
    ).toEqual([]);
  });

  it('applies several fixes to one container, which all want securityContext', () => {
    const r = fixManifest(POD(''), rules, {
      maxRisk: 'medium',
      only: ['allow-privilege-escalation', 'may-run-as-root'],
    });
    expect(r.applied).toHaveLength(2);
    expect(r.fixed).toContain(
      'securityContext:\n        allowPrivilegeEscalation: false\n        runAsNonRoot: true\n',
    );
    expect(r.fixed.match(/securityContext:/g)).toHaveLength(1);
  });

  it('keeps CRLF files CRLF', () => {
    const src = POD('').replace(/\n/g, '\r\n');
    const r = fixManifest(src, rules, only('allow-privilege-escalation'));
    expect(r.fixed.replace(/\r\n/g, '')).not.toContain('\n');
    expect(r.fixed).toContain('allowPrivilegeEscalation: false');
  });

  it('keeps a file without a final newline', () => {
    const src = POD('').replace(/\n$/, '');
    const r = fixManifest(src, rules, only('allow-privilege-escalation'));
    expect(r.fixed.endsWith('false')).toBe(true);
  });

  it('retries a fix that another fix unblocks, in the same run', () => {
    const src = POD('      securityContext:\n        privileged: true\n');
    const r = fixManifest(src, rules, {
      maxRisk: 'high',
      only: ['privileged-container', 'allow-privilege-escalation'],
    });
    expect(r.applied.map((a) => a.ruleId)).toEqual([
      'privileged-container',
      'allow-privilege-escalation',
    ]);
    expect(r.skipped).toEqual([]);
  });
});

describe('fixManifest: safety', () => {
  const all: FixOptions = {
    maxRisk: 'high',
    policy: { params: { memoryLimit: '256Mi', loadBalancerSourceRanges: ['10.0.0.0/8'] } },
  };

  it('is idempotent', () => {
    for (const file of ['risky.yaml', 'web.yaml', 'hardened.yaml']) {
      const first = fixManifest(example(file), rules, all);
      const second = fixManifest(first.fixed, rules, all);
      expect(second.status, file).toBe('unchanged');
      expect(second.fixed).toBe(first.fixed);
    }
  });

  it('does nothing to a hardened manifest', () => {
    const r = fixManifest(example('hardened.yaml'), rules, all);
    expect(r.status).toBe('unchanged');
    expect(r.fixed).toBe(r.original);
  });

  it('never leaves YAML that parses worse, and never adds findings', () => {
    for (const file of ['risky.yaml', 'web.yaml']) {
      const r = fixManifest(example(file), rules, all);
      expect(r.validation.ok).toBe(true);
      expect(r.validation.introduced).toEqual([]);
      const issues = parseManifest(r.fixed).flatMap((d) => d.issues);
      expect(issues).toEqual([]);
      const before = checkManifest(example(file), rules).documents.flatMap(
        (d) => d.findings,
      ).length;
      const after = checkManifest(r.fixed, rules).documents.flatMap((d) => d.findings).length;
      expect(after).toBe(r.remaining);
      expect(after).toBeLessThan(before);
    }
  });

  it('does not edit a document with YAML errors, but still fixes the others', () => {
    const broken =
      'apiVersion: v1\nkind: Pod\nmetadata:\n  name: bad\nspec:\n  containers:\n    - name: a\n      image: x:1\n     oops: [\n';
    const r = fixManifest(`${broken}---\n${POD('')}`, rules, only('allow-privilege-escalation'));
    expect(r.fixed.startsWith(broken)).toBe(true);
    expect(r.applied.map((a) => a.target.document)).toEqual([1]);
  });

  it('returns unchanged for empty, non-Kubernetes and non-mapping input', () => {
    for (const src of ['', '# just a comment\n', 'a: 1\n', '- 1\n- 2\n', '[unclosed']) {
      const r = fixManifest(src, rules, all);
      expect(r.status, src).toBe('unchanged');
      expect(r.fixed).toBe(src);
    }
  });

  it('reports a stale source', () => {
    const r = fixManifest(POD(''), rules, only('allow-privilege-escalation'));
    expect(isStale(r, POD(''))).toBe(false);
    expect(isStale(r, `${POD('')}# edited\n`)).toBe(true);
  });

  it('works without network access', () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('network used');
    });
    vi.stubGlobal('fetch', fetchSpy);
    try {
      expect(fixManifest(example('risky.yaml'), rules, all).status).toBe('fixed');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('skips a fix whose layout it cannot edit exactly', () => {
    const src = POD('').replace(
      '      image: nginx:1.27\n',
      '      image: nginx:1.27\n      securityContext: {}  # none yet\n',
    );
    const r = fixManifest(src, rules, only('allow-privilege-escalation'));
    expect(r.status).toBe('unchanged');
    expect(r.skipped[0]).toMatchObject({ reason: 'unsupported-layout' });
  });
});

describe('fixManifest: complex YAML', () => {
  const fixed = (src: string, extra: FixOptions = {}) => {
    const r = fixManifest(src, rules, { maxRisk: 'high', ...extra });
    expect(r.validation.ok).toBe(true);
    return r;
  };

  it('fixes flow-style containers and keeps them in flow style', () => {
    const src = POD('').replace(
      '    - name: app\n      image: nginx:1.27\n',
      '    - {name: app, image: "nginx:1.27", securityContext: {privileged: true}}\n',
    );
    const r = fixed(src, { only: ['privileged-container'] });
    expect(r.fixed).toContain(
      '- {name: app, image: "nginx:1.27", securityContext: {privileged: false}}',
    );
  });

  it('fixes a manifest written as JSON', () => {
    const src = JSON.stringify(
      {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: { name: 'j' },
        spec: {
          containers: [{ name: 'a', image: 'nginx:1.27', securityContext: { privileged: true } }],
        },
      },
      null,
      2,
    );
    const r = fixed(src, { only: ['privileged-container'] });
    expect(JSON.parse(r.fixed).spec.containers[0].securityContext.privileged).toBe(false);
    expect(r.fixed).toContain('"privileged": false');
  });

  it('fixes a container whose securityContext is an alias, without touching the anchor', () => {
    const src = `x: &sec
  readOnlyRootFilesystem: true
apiVersion: v1
kind: Pod
metadata:
  name: p
spec:
  containers:
    - name: a
      image: nginx:1.27
      securityContext: *sec
    - name: b
      image: nginx:1.27
      securityContext: *sec
`;
    const r = fixed(src, { only: ['allow-privilege-escalation'] });
    expect(r.fixed).toContain('x: &sec\n  readOnlyRootFilesystem: true\n');
    expect(r.fixed).toContain(
      '      securityContext:\n        <<: *sec\n        allowPrivilegeEscalation: false\n',
    );
    expect(r.applied).toHaveLength(2);
    expect(fixManifest(r.fixed, rules, { only: ['allow-privilege-escalation'] }).status).toBe(
      'unchanged',
    );
  });

  it('sees through merge keys when checking', () => {
    const src = `d: &d
  allowPrivilegeEscalation: false
apiVersion: v1
kind: Pod
metadata:
  name: p
spec:
  containers:
    - name: a
      image: nginx:1.27
      securityContext:
        <<: *d
`;
    const ids = checkManifest(src, rules).documents[0]?.findings.map((f) => f.ruleId);
    expect(ids).not.toContain('allow-privilege-escalation');
  });
});

describe('fixManifest: custom rules', () => {
  const custom = (yaml: string) => [
    ...rules.filter((r) => r.id === 'host-namespaces'),
    ...parseRules(yaml, 't.yaml'),
  ];

  it('leaves rules without an autofix alone and counts them', () => {
    const team = parseRules(
      'id: team-label\ntitle: t\nseverity: warning\nkinds: [Pod]\nwhen:\n  missing: metadata.labels.team\nmessage: m\nfix: Add a team label.\n',
    );
    const r = fixManifest(POD(''), team, {});
    expect(r.status).toBe('unchanged');
    expect(r.withoutFix).toBe(1);
    expect(r.skipped).toEqual([]);
  });

  it('applies a custom structured fix', () => {
    const team = parseRules(
      'id: team-label\ntitle: t\nseverity: warning\nkinds: [Pod]\nwhen:\n  missing: metadata.labels.team\nmessage: m\nautofix:\n  risk: low\n  summary: Label the Pod with the platform team.\n  set:\n    metadata.labels.team: platform\n',
    );
    const r = fixManifest(POD(''), team, {});
    expect(r.fixed).toContain('metadata:\n  name: web\n  labels:\n    team: platform\n');
    expect(fixManifest(r.fixed, team, {}).status).toBe('unchanged');
  });

  it('drops a fix that introduces another finding, and says so', () => {
    const bad = custom(
      'id: needs-host\ntitle: t\nseverity: warning\nkinds: [Pod]\nscope: pod\nwhen:\n  missing: hostNetwork\nmessage: m\nautofix:\n  risk: low\n  summary: Use host networking.\n  set:\n    hostNetwork: true\n',
    );
    const r = fixManifest(POD(''), bad, only('needs-host'));
    expect(r.status).toBe('unchanged');
    expect(r.skipped[0]).toMatchObject({ reason: 'validation-failed' });
    expect(r.skipped[0]?.detail).toContain('host-namespaces');
  });

  it('drops a fix whose finding is still reported afterwards', () => {
    const stuck = parseRules(
      'id: stuck\ntitle: t\nseverity: warning\nkinds: [Pod]\nwhen:\n  missing: metadata.labels.team\nmessage: m\nautofix:\n  risk: low\n  summary: s\n  set:\n    metadata.labels.other: x\n',
    );
    const r = fixManifest(POD(''), stuck, {});
    expect(r.skipped[0]).toMatchObject({ reason: 'validation-failed' });
    expect(r.fixed).toBe(POD(''));
  });

  it('detects two rules fixing the same field differently', () => {
    const two = parseRules(
      'id: a-first\ntitle: t\nseverity: warning\nkinds: [Pod]\nscope: container\nwhen:\n  missing: securityContext.x\nmessage: m\nautofix:\n  risk: low\n  summary: s\n  set:\n    securityContext.x: 1\n---\nid: b-second\ntitle: t\nseverity: warning\nkinds: [Pod]\nscope: container\nwhen:\n  not: { equals: { securityContext.x: 2 } }\nmessage: m\nautofix:\n  risk: low\n  summary: s\n  set:\n    securityContext.x: 2\n',
    );
    const r = fixManifest(POD(''), two, {});
    expect(r.applied.map((a) => a.ruleId)).toEqual(['a-first']);
    expect(r.skipped.find((s) => s.ruleId === 'b-second')?.reason).toBe('conflict');
  });
});

describe('autofix in rule files', () => {
  const rule = (extra: string) =>
    `id: r\ntitle: t\nseverity: info\nkinds: ['*']\nwhen: { missing: a }\nmessage: m\n${extra}`;

  it('parses', () => {
    const [r] = parseRules(
      rule(
        "autofix:\n  risk: medium\n  summary: s\n  requires: { missing: b }\n  set:\n    a.b: { $param: p, pattern: '^x$' }\n    c: 1\n",
      ),
    );
    expect(r?.autofix).toMatchObject({
      risk: 'medium',
      summary: 's',
      set: [
        { path: 'a.b', param: 'p' },
        { path: 'c', value: 1 },
      ],
    });
    expect(r?.autofix?.set[0]?.pattern?.test('x')).toBe(true);
  });

  it('rejects mistakes with a clear error', () => {
    const bad: [string, RegExp][] = [
      ['autofix: yes\n', /must be a mapping/],
      ['autofix: { risk: safe, summary: s, set: { a: 1 } }\n', /autofix.risk/],
      ['autofix: { risk: low, set: { a: 1 } }\n', /autofix.summary/],
      ['autofix: { risk: low, summary: s }\n', /autofix.set/],
      ['autofix: { risk: low, summary: s, set: { "a[]": 1 } }\n', /plain dotted keys/],
      ['autofix: { risk: low, summary: s, set: { "$pod.a": 1 } }\n', /plain dotted keys/],
      ['autofix: { risk: low, summary: s, set: { a: 1, a.b: 2 } }\n', /cannot both be set/],
      ['autofix: { risk: low, summary: s, set: { a: { $param: "x y" } } }\n', /\$param/],
      ['autofix: { risk: low, summary: s, set: { a: 1 }, extra: 1 }\n', /unknown key "extra"/],
    ];
    for (const [extra, message] of bad) {
      expect(() => parseRules(rule(extra)), extra).toThrow(RuleError);
      expect(() => parseRules(rule(extra)), extra).toThrow(message);
    }
  });

  it('keeps old rules working: no autofix, same findings', () => {
    const [r] = parseRules(rule(''));
    expect(r?.autofix).toBeUndefined();
  });
});

describe('parseFixPolicy', () => {
  it('reads params', () => {
    expect(parseFixPolicy('params:\n  memoryLimit: 256Mi\n')).toEqual({
      params: { memoryLimit: '256Mi' },
    });
    expect(parseFixPolicy('')).toEqual({ params: {} });
  });
  it('rejects bad files', () => {
    expect(() => parseFixPolicy('params: 3')).toThrow(/mapping/);
    expect(() => parseFixPolicy('param: {}')).toThrow(/unknown key/);
    expect(() => parseFixPolicy('params:\n  a:\n')).toThrow(/no value/);
    expect(() => parseFixPolicy('- a')).toThrow(/mapping/);
    expect(() => parseFixPolicy('a: [')).toThrow();
  });
});

describe('fixManifest: choosing findings', () => {
  const two = `${POD('')}    - name: other\n      image: busybox:1.36\n`;

  it('fixes only the named findings, by rule and original line', () => {
    const all = checkManifest(two, rules).documents[0]?.findings ?? [];
    const second = all.filter((f) => f.ruleId === 'allow-privilege-escalation')[1];
    const r = fixManifest(two, rules, {
      findings: [{ ruleId: 'allow-privilege-escalation', line: second?.line ?? 0 }],
    });
    expect(r.applied).toHaveLength(1);
    expect(r.applied[0]?.target.scope).toBe('spec.containers[1]');
  });

  it('does not fix a different rule on the same line', () => {
    const line =
      (checkManifest(two, rules).documents[0]?.findings ?? []).find(
        (f) => f.ruleId === 'allow-privilege-escalation',
      )?.line ?? 0;
    const r = fixManifest(two, rules, { findings: [{ ruleId: 'no-such-rule', line }] });
    expect(r.status).toBe('unchanged');
  });
});

describe('the shipped example', () => {
  const policy = parseFixPolicy(example('fix-policy.yaml'));

  it('is fixed as documented, validated, and idempotent', () => {
    const src = example('fixable.yaml');
    const r = fixManifest(src, rules, { maxRisk: 'medium', policy });
    expect(r.status).toBe('fixed');
    expect(r.applied.map((a) => a.ruleId).sort()).toEqual([
      'allow-privilege-escalation',
      'default-service-account-token',
      'loadbalancer-open-to-world',
      'may-run-as-root',
      'may-run-as-root',
      'missing-memory-limit',
      'missing-memory-limit',
      'missing-seccomp-profile',
      'missing-seccomp-profile',
    ]);
    // The privileged sidecar is held back, and so is the escalation fix that depends on it.
    expect(r.skipped.map((s) => s.ruleId).sort()).toEqual([
      'allow-privilege-escalation',
      'privileged-container',
    ]);
    expect(r.fixed).toContain('# owned by team-a');
    expect(r.fixed).toContain('# needs review: never fixed unless you allow high risk');
    expect(r.fixed).toContain('privileged: true');
    expect(r.validation.ok).toBe(true);
    expect(fixManifest(r.fixed, rules, { maxRisk: 'medium', policy }).status).toBe('unchanged');
  });

  it('applies the held-back fixes in dependency order when high risk is allowed', () => {
    const r = fixManifest(example('fixable.yaml'), rules, { maxRisk: 'high', policy });
    expect(r.skipped).toEqual([]);
    expect(r.fixed).toContain('privileged: false');
  });
});

describe('skip messages', () => {
  it('names the setting that blocks a fix, and where a missing value goes', () => {
    const root = POD('      securityContext:\n        runAsUser: 0\n');
    const blocked = fixManifest(root, rules, only('may-run-as-root', { maxRisk: 'medium' }));
    expect(blocked.skipped[0]?.detail).toContain('runAsUser is 0');
    const needs = fixManifest(POD(''), rules, only('missing-memory-limit', { maxRisk: 'medium' }));
    expect(needs.skipped[0]?.detail).toBe(
      'Needs the policy value "memoryLimit": add it under "params:" in the fix policy.',
    );
  });

  it('accepts and validates a blocked message in rule files', () => {
    const base =
      "id: r\ntitle: t\nseverity: info\nkinds: ['*']\nwhen: { missing: a }\nmessage: m\n";
    const ok = parseRules(
      `${base}autofix: { risk: low, summary: s, blocked: why, set: { a: 1 } }\n`,
    );
    expect(ok[0]?.autofix?.blockedMessage).toBe('why');
    expect(() =>
      parseRules(`${base}autofix: { risk: low, summary: s, blocked: 3, set: { a: 1 } }\n`),
    ).toThrow(/autofix.blocked/);
  });
});

describe('reported lines', () => {
  it('are lines of the original text, even after earlier fixes added lines above', () => {
    const src = `${POD('')}    - name: other\n      image: busybox:1.36\n`;
    const original = src.split('\n');
    const r = fixManifest(src, rules, { maxRisk: 'medium' });
    expect(r.applied.length).toBeGreaterThan(2);
    for (const a of [...r.applied, ...r.skipped]) {
      const text = original[a.line - 1] ?? '';
      // Each finding points at a real line of the container it is about.
      expect(text, `${a.ruleId} line ${a.line}`).toMatch(
        /name: (app|other)|image:|securityContext|resources|containers:/,
      );
    }
    const second = r.applied.find((a) => a.target.scope.endsWith('containers[1]'));
    expect(original[(second?.line ?? 0) - 1]).toContain('name: other');
  });
});

describe('fixManifest: kinds without rules', () => {
  const typo = POD('').replace('kind: Pod', 'kind: Poddsds');

  it('reports a document of an unknown kind instead of silently doing nothing', () => {
    const r = fixManifest(typo, rules, { maxRisk: 'high' });
    expect(r.status).toBe('unchanged');
    expect(r.notChecked).toHaveLength(1);
    expect(r.notChecked[0]).toMatchObject({ document: 0, kind: 'Poddsds', level: 'unchecked' });
    expect(r.notChecked[0]).toMatchObject({
      headline: 'Unknown kind "Poddsds"',
      suggestion: 'Pod',
    });
    expect(r.notChecked[0]?.message).toMatch(/Did you mean "Pod"\?/);
  });

  it('reports nothing for kinds the rules cover', () => {
    expect(fixManifest(POD(''), rules).notChecked).toEqual([]);
  });

  it('does not suggest a kind for a custom resource', () => {
    const crd = 'apiVersion: cert-manager.io/v1\nkind: Certificate\nmetadata: {name: c}\n';
    const [d] = fixManifest(crd, rules).notChecked;
    expect(d?.message).toMatch(/custom resource/);
    expect(d?.message).not.toMatch(/typo/);
  });
});
