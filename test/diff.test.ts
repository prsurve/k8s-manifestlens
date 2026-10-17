import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { diffManifests } from '../src/core/index.js';
import { diffData } from '../src/core/diff/deep.js';
import { run } from '../src/cli/main.js';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const read = (name: string) => readFileSync(fixture(name), 'utf8');

const deployment = (extra: string, replicas = 2) => `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: ${replicas}
  template:
    spec:
      containers:
        - name: web
          image: nginx:1.27
${extra}`;

function change(oldYaml: string, newYaml: string, path: string) {
  const [doc] = diffManifests(oldYaml, newYaml, []).documents;
  return doc?.changes.find((c) => c.path === path);
}

describe('diffData', () => {
  it('matches named list items by name, so reordering is not a change', () => {
    const a = {
      containers: [
        { name: 'a', image: '1' },
        { name: 'b', image: '1' },
      ],
    };
    const b = {
      containers: [
        { name: 'b', image: '1' },
        { name: 'a', image: '1' },
      ],
    };
    expect(diffData(a, b)).toEqual([]);
  });

  it('reports added, removed and changed fields with the enclosing item name', () => {
    const a = { containers: [{ name: 'a', image: '1', old: true }] };
    const b = { containers: [{ name: 'a', image: '2', fresh: 1 }, { name: 'c' }] };
    expect(diffData(a, b)).toEqual([
      {
        type: 'changed',
        path: 'containers[0].image',
        before: '1',
        after: '2',
        within: [{ list: 'containers', name: 'a' }],
      },
      {
        type: 'added',
        path: 'containers[0].fresh',
        after: 1,
        within: [{ list: 'containers', name: 'a' }],
      },
      {
        type: 'removed',
        path: 'containers[0].old',
        before: true,
        within: [{ list: 'containers', name: 'a' }],
      },
      {
        type: 'added',
        path: 'containers[1]',
        after: { name: 'c' },
        within: [{ list: 'containers', name: 'c' }],
      },
    ]);
  });

  it('compares lists of plain values as a whole and unnamed objects by position', () => {
    expect(diffData({ args: ['a', 'b'] }, { args: ['a', 'c'] })).toEqual([
      { type: 'changed', path: 'args', before: ['a', 'b'], after: ['a', 'c'], within: [] },
    ]);
    expect(diffData({ ports: [{ port: 1 }] }, { ports: [{ port: 2 }, { port: 3 }] })).toMatchObject(
      [
        { type: 'changed', path: 'ports[0].port', before: 1, after: 2 },
        { type: 'added', path: 'ports[1]' },
      ],
    );
  });
});

describe('diffManifests', () => {
  it('matches objects by kind, namespace and name and reports added, removed and unchanged', () => {
    const { documents, issues } = diffManifests(read('diff-old.yaml'), read('diff-new.yaml'), []);
    expect(issues).toEqual([]);
    expect(documents.map((d) => [d.kind, d.name, d.status])).toEqual([
      ['Deployment', 'web', 'changed'],
      ['Service', 'web', 'changed'],
      ['Service', 'metrics', 'added'],
      ['Service', 'steady', 'unchanged'],
      ['Service', 'legacy', 'removed'],
    ]);
  });

  it('reports identical files as unchanged', () => {
    const docs = diffManifests(read('hardened.yaml'), read('hardened.yaml')).documents;
    expect(docs.every((d) => d.status === 'unchanged')).toBe(true);
    expect(docs.every((d) => d.newFindings.length === 0 && d.resolvedFindings.length === 0)).toBe(
      true,
    );
  });

  it('treats the same name in another namespace as a different object', () => {
    const a = 'kind: Service\nmetadata:\n  name: x\n  namespace: one\n';
    const b = 'kind: Service\nmetadata:\n  name: x\n  namespace: two\n';
    expect(
      diffManifests(a, b, [])
        .documents.map((d) => d.status)
        .sort(),
    ).toEqual(['added', 'removed']);
  });

  it('ignores status and server-set metadata', () => {
    const a = 'kind: Service\nmetadata:\n  name: x\n  resourceVersion: "1"\nstatus:\n  a: 1\n';
    const b = 'kind: Service\nmetadata:\n  name: x\n  resourceVersion: "2"\nstatus:\n  a: 2\n';
    expect(diffManifests(a, b, []).documents[0]?.status).toBe('unchanged');
  });

  it('uses the line in the new file, or the old file for removed fields', () => {
    const old = read('diff-old.yaml');
    const now = read('diff-new.yaml');
    const [web] = diffManifests(old, now, []).documents;
    expect(web?.changes.find((c) => c.path === 'spec.replicas')?.line).toBe(6);
    const probe = web?.changes.find((c) => c.type === 'removed');
    expect(probe?.path).toBe('spec.template.spec.containers[0].readinessProbe');
    expect(probe?.line).toBe(29); // in the old file
  });

  it('reports findings the change introduces and resolves', () => {
    const bad =
      'kind: Pod\nmetadata:\n  name: p\nspec:\n  containers:\n    - name: a\n      image: nginx\n';
    const good = bad.replace('image: nginx', 'image: nginx:1.27');
    const toBad = diffManifests(good, bad).documents[0];
    expect(toBad?.newFindings.map((f) => f.ruleId)).toContain('image-latest-tag');
    const toGood = diffManifests(bad, good).documents[0];
    expect(toGood?.resolvedFindings.map((f) => f.ruleId)).toContain('image-latest-tag');
    expect(toGood?.newFindings.map((f) => f.ruleId)).not.toContain('image-latest-tag');
  });

  it('flags documents it cannot match and YAML errors, naming the side', () => {
    const { issues } = diffManifests('kind: Pod\n', 'kind: Pod\nmetadata:\n  name: [oops\n', []);
    expect(issues.map((i) => i.side)).toContain('old');
    expect(issues.map((i) => i.side)).toContain('new');
  });
});

describe('effects', () => {
  const base = deployment('');
  it('explains scaling up, down and to zero without a rollout', () => {
    const up = change(base, deployment('', 5), 'spec.replicas');
    expect(up).toMatchObject({ effect: expect.stringContaining('3 more Pods will be started') });
    expect(change(base, deployment('', 1), 'spec.replicas')).toMatchObject({
      effect: expect.stringContaining('1 Pod will be stopped'),
    });
    expect(change(base, deployment('', 0), 'spec.replicas')).toMatchObject({
      effect: expect.stringContaining('unavailable'),
    });
    const [doc] = diffManifests(base, deployment('', 5), []).documents;
    expect(doc?.notes[0]).toMatch(/no rollout/);
  });

  it('says a template change causes a rolling update, or downtime with Recreate', () => {
    const next = base.replace('nginx:1.27', 'nginx:1.28');
    expect(diffManifests(base, next, []).documents[0]?.notes[0]).toMatch(/rolling update/);
    const recreate = (y: string) =>
      y.replace('spec:\n  replicas', 'spec:\n  strategy:\n    type: Recreate\n  replicas');
    expect(diffManifests(recreate(base), recreate(next), []).documents[0]?.notes[0]).toMatch(
      /downtime/,
    );
  });

  it('does not announce a rollout while the Deployment is paused', () => {
    const paused = (y: string) =>
      y.replace('spec:\n  replicas', 'spec:\n  paused: true\n  replicas');
    const next = base.replace('nginx:1.27', 'nginx:1.28');
    expect(diffManifests(paused(base), paused(next), []).documents[0]?.notes).toEqual([]);
  });

  it('warns about unpinned images', () => {
    const c = change(
      base,
      base.replace('nginx:1.27', 'nginx:latest'),
      'spec.template.spec.containers[0].image',
    );
    expect(c?.type).toBe('changed');
    expect(c?.effect).toMatch(/no fixed version/);
  });

  it('names env vars and containers in effects', () => {
    const withEnv = (v: string) =>
      `${deployment('')}          env:\n            - name: MODE\n              value: ${v}\n`;
    const c = change(withEnv('a'), withEnv('b'), 'spec.template.spec.containers[0].env[0].value');
    expect(c?.effect).toContain('MODE in container "web" changes from a to b');
  });

  it('rejects selector changes on a Deployment', () => {
    const sel = (v: string) =>
      deployment('').replace(
        '  replicas',
        `  selector:\n    matchLabels:\n      app: ${v}\n  replicas`,
      );
    const c = change(sel('a'), sel('b'), 'spec.selector.matchLabels.app');
    expect(c?.effect).toMatch(/does not allow changing the selector/);
  });

  it('explains Service changes', () => {
    const svc = (extra: string) => `kind: Service\nmetadata:\n  name: s\nspec:\n${extra}`;
    const effect = (a: string, b: string, path: string) => change(svc(a), svc(b), path)?.effect;
    expect(effect('  type: ClusterIP\n', '  type: NodePort\n', 'spec.type')).toMatch(
      /opens a port on every node/,
    );
    expect(effect('  selector:\n    a: b\n', '  selector:\n    a: c\n', 'spec.selector.a')).toMatch(
      /different set of Pods/,
    );
    expect(effect('  clusterIP: 10.0.0.1\n', '  clusterIP: 10.0.0.2\n', 'spec.clusterIP')).toMatch(
      /reject/,
    );
  });

  it('says most Pod fields cannot be changed in place, but images can', () => {
    const pod = (image: string, host: string) =>
      `kind: Pod\nmetadata:\n  name: p\nspec:\n  hostNetwork: ${host}\n  containers:\n    - name: a\n      image: ${image}\n`;
    const diff = diffManifests(pod('x:1', 'false'), pod('x:2', 'true'), []).documents[0];
    const image = diff?.changes.find((c) => c.path.endsWith('image'));
    const host = diff?.changes.find((c) => c.path === 'spec.hostNetwork');
    expect(image?.effect).not.toMatch(/reject/);
    expect(host?.effect).toMatch(/reject/);
  });

  it('attaches the field explanation and docs link', () => {
    const c = change(base, deployment('', 3), 'spec.replicas');
    expect(c).toMatchObject({
      explanation: expect.stringContaining('identical Pods'),
      docsUrl: expect.stringContaining('kubernetes.io'),
    });
  });
});

describe('manifestlens diff', () => {
  const cli = (...args: string[]) => {
    let stdout = '';
    let stderr = '';
    const code = run(args, { stdout: (t) => (stdout += t), stderr: (t) => (stderr += t) });
    return { code, stdout, stderr };
  };
  const oldF = fixture('diff-old.yaml');
  const newF = fixture('diff-new.yaml');

  it('prints a readable summary', () => {
    const { code, stdout } = cli('diff', oldF, newF);
    expect(code).toBe(0);
    expect(stdout).toContain('== Deployment "web": changed ==');
    expect(stdout).toContain('Scales up from 2 to 5');
    expect(stdout).toContain(
      'line 29 (old file)  - spec.template.spec.containers[0].readinessProbe',
    );
    expect(stdout).toContain('== Service "metrics": added ==');
    expect(stdout).toContain('== Service "legacy": removed ==');
    expect(stdout).toMatch(
      /2 changed, 1 added, 1 removed, 1 unchanged\. Findings: \d+ new, 0 resolved\./,
    );
  });

  it('fails when the change adds findings at the --fail-on level', () => {
    expect(cli('diff', oldF, newF, '--fail-on', 'warning').code).toBe(1);
    expect(cli('diff', oldF, newF, '--fail-on', 'error').code).toBe(0);
    expect(cli('diff', oldF, oldF, '--fail-on', 'info').code).toBe(0);
  });

  it('needs exactly two readable files', () => {
    expect(cli('diff', oldF).code).toBe(2);
    expect(cli('diff', oldF, newF, oldF).code).toBe(2);
    const missing = cli('diff', oldF, fixture('nope.yaml'));
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain('Cannot read');
  });
});
