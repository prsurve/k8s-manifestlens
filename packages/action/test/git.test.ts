import { renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { determineBase } from '../src/base.js';
import { changedFiles, fileAt, resolveCommit } from '../src/git.js';
import { DEFAULTS } from '../src/settings.js';
import { POD, commitAll, gitRepo } from './helpers.js';

describe('git helpers on a real repository', () => {
  const { dir, commit: base } = gitRepo({
    'k8s/a.yaml': POD('a:1'),
    'k8s/b.yaml': POD('b:1', 'b'),
    'README.md': 'hi\n',
  });
  writeFileSync(join(dir, 'k8s/a.yaml'), POD('a:2')); // modified
  writeFileSync(join(dir, 'k8s/c.yaml'), POD('c:1', 'c')); // added
  renameSync(join(dir, 'k8s/b.yaml'), join(dir, 'k8s/d.yaml')); // renamed
  writeFileSync(join(dir, 'README.md'), 'changed\n');
  const head = commitAll(dir);

  it('resolves a commit, and returns null for one the checkout does not have', () => {
    expect(resolveCommit(dir, base)).toBe(base);
    expect(resolveCommit(dir, 'HEAD~1')).toBe(base);
    expect(resolveCommit(dir, 'main')).toBe(head);
    expect(resolveCommit(dir, 'ffffffffffffffffffffffffffffffffffffffff')).toBeNull();
    expect(resolveCommit(dir, 'no-such-branch')).toBeNull();
  });

  it('cannot be tricked into running an option by a ref that looks like one', () => {
    expect(resolveCommit(dir, '--help')).toBeNull();
    expect(resolveCommit(dir, '--upload-pack=touch /tmp/pwned')).toBeNull();
  });

  it('lists the files a change touches, with renames mapped to their old path', () => {
    const changed = changedFiles(dir, base);
    expect(changed.get('k8s/a.yaml')).toBeNull();
    expect(changed.get('k8s/c.yaml')).toBeNull();
    expect(changed.get('k8s/d.yaml')).toBe('k8s/b.yaml');
    expect(changed.has('README.md')).toBe(true);
    expect(changed.has('k8s/b.yaml')).toBe(false);
  });

  it('reads a file as it was at the base, or null if it did not exist there', () => {
    expect(fileAt(dir, base, 'k8s/a.yaml')).toBe(POD('a:1'));
    expect(fileAt(dir, base, 'k8s/b.yaml')).toBe(POD('b:1', 'b'));
    expect(fileAt(dir, base, 'k8s/c.yaml')).toBeNull();
  });

  it('copes with file names that need quoting', () => {
    const repo = gitRepo({ 'plain.yaml': POD('x:1') });
    writeFileSync(join(repo.dir, 'sp ace "q".yaml'), POD('y:1'));
    commitAll(repo.dir);
    expect(changedFiles(repo.dir, repo.commit).has('sp ace "q".yaml')).toBe(true);
  });
});

describe('determineBase', () => {
  const s = DEFAULTS;
  const sha = 'a'.repeat(40);

  it('prefers the base-ref input', () => {
    expect(determineBase({ ...s, baseRef: 'origin/main' }, 'pull_request', {})).toEqual({
      ref: 'origin/main',
      source: 'base-ref input',
    });
  });

  it('uses the pull request base, the merge group base, or the commit before a push', () => {
    expect(determineBase(s, 'pull_request', { pull_request: { base: { sha } } })?.ref).toBe(sha);
    expect(determineBase(s, 'pull_request_target', { pull_request: { base: { sha } } })?.ref).toBe(
      sha,
    );
    expect(determineBase(s, 'merge_group', { merge_group: { base_sha: sha } })?.ref).toBe(sha);
    expect(determineBase(s, 'push', { before: sha })?.ref).toBe(sha);
  });

  it('gives up where there is nothing to compare with', () => {
    expect(determineBase(s, 'push', { before: '0'.repeat(40) })).toBeNull(); // first push to a branch
    expect(determineBase(s, 'workflow_dispatch', {})).toBeNull();
    expect(determineBase(s, 'schedule', undefined)).toBeNull();
  });

  it('refuses a value from the event that is not a commit id', () => {
    expect(determineBase(s, 'push', { before: '--upload-pack=x' })).toBeNull();
    expect(determineBase(s, 'pull_request', { pull_request: { base: { sha: 123 } } })).toBeNull();
  });
});
