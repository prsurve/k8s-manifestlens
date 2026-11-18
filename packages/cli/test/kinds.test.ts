import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { run, runCli } from '../src/main.js';
import { registryPath } from '../src/registry.js';

process.env.K8S_MANIFESTLENS_REGISTRY = join(tmpdir(), 'k8s-manifestlens-no-such-registry.json');

const dir = mkdtempSync(join(tmpdir(), 'ml-kinds-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const reg = join(dir, 'kinds.json');
const file = (name: string, text: string): string => {
  const p = join(dir, name);
  writeFileSync(p, text);
  return p;
};

const CRD = `apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
spec:
  group: w.io
  scope: Namespaced
  names: { kind: Widget }
  versions:
    - name: v1
      schema:
        openAPIV3Schema:
          type: object
          properties:
            spec:
              type: object
              required: [size]
              properties:
                size: { type: integer, maximum: 5 }
                tags: { type: array, minItems: 1, items: { type: string } }
`;
const MANIFEST = 'apiVersion: w.io/v1\nkind: Widget\nspec:\n  size: 9\n';

async function cli(...args: string[]) {
  let stdout = '';
  let stderr = '';
  const code = await runCli(args, { stdout: (t) => (stdout += t), stderr: (t) => (stderr += t) });
  return { code, stdout, stderr };
}

describe('kinds', () => {
  const crd = file('widget-crd.yaml', CRD);
  const manifest = file('widget.yaml', MANIFEST);

  it('says what is not checked when previewing, and saves nothing', async () => {
    const r = await cli('kinds', 'preview', crd, '--registry', reg);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/NOT checked/);
    expect(r.stdout).toMatch(/minItems/);
    expect(existsSync(reg)).toBe(false);
  });

  it('is unsupported before add, supported and validated after', async () => {
    const missing = await cli('check', manifest, '--registry', reg);
    expect(missing.code).toBe(2); // the explicit registry does not exist yet
    expect(run(['explain', manifest], { stdout: () => undefined, stderr: () => undefined })).toBe(
      0,
    );

    const add = await cli('kinds', 'add', crd, '--registry', reg);
    expect(add.code).toBe(0);
    expect(add.stdout).toMatch(/Registered w.io\/v1\/Widget/);
    expect(statSync(reg).mode & 0o777).toBe(0o600);

    let out = '';
    const code = run(['check', manifest, '--registry', reg], {
      stdout: (t) => (out += t),
      stderr: () => undefined,
    });
    expect(code).toBe(1);
    expect(out).toMatch(/above the maximum/);

    out = '';
    run(['check', manifest, '--registry', reg, '--no-registry'], {
      stdout: (t) => (out += t),
      stderr: () => undefined,
    });
    expect(out).not.toMatch(/above the maximum/);
  });

  it('lists, disables, enables, exports, imports and removes', async () => {
    expect((await cli('kinds', 'list', '--registry', reg)).stdout).toMatch(/enabled\tWidget/);
    await cli('kinds', 'disable', 'Widget', '--registry', reg);
    expect((await cli('kinds', 'list', '--registry', reg)).stdout).toMatch(/disabled/);
    await cli('kinds', 'enable', 'Widget', '--registry', reg);

    const exported = (await cli('kinds', 'export', '--registry', reg)).stdout;
    const copy = join(dir, 'copy.json');
    const bundle = file('bundle.json', exported);
    const imported = await cli('kinds', 'import', bundle, '--registry', copy);
    expect(imported.stdout).toMatch(/Imported 1/);
    expect(readFileSync(copy, 'utf8')).toContain('Widget');

    expect((await cli('kinds', 'remove', 'Widget', '--registry', reg)).code).toBe(0);
    expect((await cli('kinds', 'list', '--registry', reg)).stdout).toMatch(/No imported kinds/);
    expect((await cli('kinds', 'remove', 'Widget', '--registry', reg)).code).toBe(2);
  });

  it('refuses to override a built-in kind', async () => {
    const ingress = CRD.replace('group: w.io', 'group: networking.k8s.io').replace(
      'Widget',
      'Ingress',
    );
    const r = await cli(
      'kinds',
      'add',
      file('ingress.yaml', ingress),
      '--registry',
      join(dir, 'b.json'),
    );
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/built-in/);
    expect(existsSync(join(dir, 'b.json'))).toBe(false);
  });

  it('lets --crd on the command line win over the registry copy', async () => {
    await cli('kinds', 'add', crd, '--registry', reg);
    const loose = file('loose.yaml', CRD.replace('maximum: 5', 'maximum: 50'));
    let out = '';
    const code = run(['check', manifest, '--registry', reg, '--crd', loose], {
      stdout: (t) => (out += t),
      stderr: () => undefined,
    });
    expect(code).toBe(0);
    expect(out).not.toMatch(/above the maximum/);
  });

  it('reports a corrupt registry instead of ignoring it', () => {
    const bad = file('corrupt.json', '{nope');
    let err = '';
    expect(
      run(['explain', manifest, '--registry', bad], {
        stdout: () => undefined,
        stderr: (t) => (err += t),
      }),
    ).toBe(2);
    expect(err).toMatch(/Cannot read the kind registry/);
  });

  it('explains how to onboard an unsupported kind', () => {
    const lease = file('lease.yaml', 'apiVersion: coordination.k8s.io/v1\nkind: Lease\n');
    let out = '';
    run(['explain', lease], { stdout: (t) => (out += t), stderr: () => undefined });
    expect(out).toMatch(/built-in Kubernetes kind/);
    expect(out).toMatch(/kinds add/);
  });

  it('resolves the registry location: flag, then env, then the config folder', () => {
    expect(registryPath('/x.json', {}, '/home/u')).toBe('/x.json');
    expect(registryPath(undefined, { K8S_MANIFESTLENS_REGISTRY: '/e.json' }, '/home/u')).toBe(
      '/e.json',
    );
    expect(registryPath(undefined, { XDG_CONFIG_HOME: '/cfg' }, '/home/u')).toBe(
      '/cfg/k8s-manifestlens/kinds.json',
    );
    expect(registryPath(undefined, {}, '/home/u')).toBe(
      '/home/u/.config/k8s-manifestlens/kinds.json',
    );
  });
});
