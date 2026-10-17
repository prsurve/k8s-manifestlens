import { symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError } from '../src/coerce.js';
import { buildPatterns, discover } from '../src/discover.js';
import { DEFAULTS } from '../src/settings.js';
import type { Settings } from '../src/types.js';
import { POD, tempDir } from './helpers.js';

const s = (patch: Partial<Settings> = {}): Settings => ({ ...DEFAULTS, ...patch });
const paths = async (dir: string, patch: Partial<Settings> = {}) =>
  (await discover(s(patch), dir)).files.map((f) => f.path);

describe('discover', () => {
  it('finds Kubernetes manifests and ignores other YAML', async () => {
    const dir = tempDir({
      'k8s/app.yaml': POD('a:1'),
      'k8s/svc.yml': 'apiVersion: v1\nkind: Service\nmetadata:\n  name: s\n',
      '.github/workflows/ci.yaml': 'name: ci\non: push\njobs: {}\n',
      'docker-compose.yaml': 'services:\n  web:\n    image: nginx\n',
      'charts/t.yaml': 'apiVersion: v1\nkind: Service\nmetadata:\n  name: {{ .Values.n }}\n',
      'notes.txt': POD('x:1'),
    });
    expect(await paths(dir)).toEqual(['k8s/app.yaml', 'k8s/svc.yml']);
  });

  it('returns the text of each file and a forward-slash path relative to the workspace', async () => {
    const dir = tempDir({ 'a/b/c.yaml': POD('a:1') });
    const { files, matched } = await discover(s(), dir);
    expect(files).toEqual([{ path: 'a/b/c.yaml', text: POD('a:1') }]);
    expect(matched).toBe(1);
  });

  it('honours patterns and exclusions', async () => {
    const dir = tempDir({
      'k8s/a.yaml': POD('a:1'),
      'k8s/legacy/b.yaml': POD('b:1'),
      'other/c.yaml': POD('c:1'),
    });
    expect(await paths(dir, { paths: ['k8s/**'] })).toEqual(['k8s/a.yaml', 'k8s/legacy/b.yaml']);
    expect(await paths(dir, { paths: ['k8s/**', '!k8s/legacy/**'] })).toEqual(['k8s/a.yaml']);
    expect(await paths(dir, { paths: ['**/*.yaml', '!other/**'] })).toEqual([
      'k8s/a.yaml',
      'k8s/legacy/b.yaml',
    ]);
  });

  it('resolves patterns under the working directory', async () => {
    const dir = tempDir({ 'envs/prod/a.yaml': POD('a:1'), 'envs/dev/b.yaml': POD('b:1') });
    expect(await paths(dir, { workingDirectory: 'envs/prod', paths: ['**/*.yaml'] })).toEqual([
      'envs/prod/a.yaml',
    ]);
  });

  it('always skips node_modules and .git', async () => {
    const dir = tempDir({
      'node_modules/x/a.yaml': POD('a:1'),
      '.git/b.yaml': POD('b:1'),
      'ok.yaml': POD('c:1'),
    });
    expect(await paths(dir)).toEqual(['ok.yaml']);
  });

  it('skips files over the size limit and says so', async () => {
    const dir = tempDir({
      'big.yaml': POD('a:1') + '# ' + 'x'.repeat(2048) + '\n',
      'small.yaml': POD('b:1'),
    });
    const found = await discover(s({ maxFileSizeKb: 1 }), dir);
    expect(found.files.map((f) => f.path)).toEqual(['small.yaml']);
    expect(found.skipped).toEqual([
      { path: 'big.yaml', reason: 'larger than max-file-size-kb (1)' },
    ]);
  });

  it('refuses a pattern that matches too many files, with advice', async () => {
    const dir = tempDir(
      Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`f${i}.yaml`, POD('a:1')])),
    );
    await expect(discover(s({ maxFiles: 3 }), dir)).rejects.toThrow(ConfigError);
    await expect(discover(s({ maxFiles: 3 }), dir)).rejects.toMatchObject({
      problems: [expect.stringContaining('Narrow "paths" or raise max-files')],
    });
  });

  it('does not follow a symbolic link out of the repository', async () => {
    const outside = tempDir({ 'secret.yaml': POD('leak:1') });
    const dir = tempDir({ 'ok.yaml': POD('a:1') });
    symlinkSync(join(outside, 'secret.yaml'), join(dir, 'link.yaml'));
    symlinkSync(outside, join(dir, 'linked-dir'));
    expect(await paths(dir)).toEqual(['ok.yaml']);
  });

  it('finds nothing in an empty folder', async () => {
    expect(await paths(tempDir())).toEqual([]);
  });
});

describe('buildPatterns', () => {
  it('makes patterns absolute, keeps exclusions as exclusions, and adds the built-in ones', () => {
    const text = buildPatterns(
      s({ paths: ['k8s/**', '!k8s/old/**'], workingDirectory: 'app' }),
      '/ws',
    );
    expect(text.split('\n')).toEqual([
      '/ws/app/k8s/**',
      '!/ws/app/k8s/old/**',
      '!/ws/app/**/node_modules/**',
      '!/ws/app/**/.git/**',
    ]);
  });
});
