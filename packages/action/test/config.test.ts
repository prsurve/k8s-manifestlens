import { symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Problems } from '../src/coerce.js';
import { loadConfig } from '../src/config.js';
import { tempDir } from './helpers.js';

const load = (dir: string, file = '.github/k8s-manifestlens.yml', explicit = false) => {
  const p = new Problems();
  const loaded = loadConfig(dir, file, explicit, p);
  return { ...loaded, problems: p.items };
};

describe('loadConfig', () => {
  it('reads the settings and says which file it used', () => {
    const dir = tempDir({
      '.github/k8s-manifestlens.yml':
        'version: 1\nfail-on: warning\nmax-warnings: 10\nignore:\n  - path: "jobs/**"\n    rules: [missing-readiness-probe]\n',
    });
    const { layer, path, problems } = load(dir);
    expect(problems).toEqual([]);
    expect(path).toBe('.github/k8s-manifestlens.yml');
    expect(layer).toMatchObject({
      failOn: 'warning',
      maxWarnings: 10,
      ignore: [{ path: 'jobs/**', rules: ['missing-readiness-probe'] }],
    });
  });

  it('is fine with a missing file at the default location', () => {
    expect(load(tempDir())).toEqual({ layer: {}, path: null, problems: [] });
  });

  it('is an error when a file named in the workflow is missing', () => {
    expect(load(tempDir(), 'ci/ml.yml', true).problems).toEqual([
      'config-file: "ci/ml.yml" does not exist.',
    ]);
  });

  it('reports YAML syntax errors against the file name', () => {
    const { problems } = load(tempDir({ '.github/k8s-manifestlens.yml': 'fail-on: [oops\n' }));
    expect(problems[0]).toMatch(/^\.github\/k8s-manifestlens\.yml: not valid YAML\./);
  });

  it('passes on problems with the settings, naming the file', () => {
    const { problems } = load(
      tempDir({ '.github/k8s-manifestlens.yml': 'fail-onn: error\nmode: loud\n' }),
    );
    expect(problems).toHaveLength(2);
    expect(problems.join('\n')).toContain(
      '.github/k8s-manifestlens.yml: unknown setting "fail-onn" (did you mean "fail-on"?).',
    );
  });

  it('treats an empty file as no settings', () => {
    expect(
      load(tempDir({ '.github/k8s-manifestlens.yml': '# only a comment\n' })).problems,
    ).toEqual([]);
  });

  it('refuses a config file that is a link out of the repository', () => {
    const outside = tempDir({ 'evil.yml': 'fail-on: none\n' });
    const dir = tempDir();
    symlinkSync(join(outside, 'evil.yml'), join(dir, 'link.yml'));
    expect(load(dir, 'link.yml', true).problems[0]).toContain('points outside the repository');
  });

  it('refuses a folder, and a file that is far too large', () => {
    expect(load(tempDir({ 'dir/x.txt': '' }), 'dir', true).problems[0]).toContain('is not a file');
    expect(
      load(tempDir({ 'big.yml': `# ${'x'.repeat(300 * 1024)}\n` }), 'big.yml', true).problems[0],
    ).toContain('larger than 256 KB');
  });
});
