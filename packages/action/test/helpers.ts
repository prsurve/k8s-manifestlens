import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const example = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../examples/${name}`, import.meta.url)), 'utf8');

/** A throwaway folder holding the given files. */
export function tempDir(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'manifestlens-test-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@example.com',
};

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' }).trim();
}

/** A real repository with one commit of the given files; returns its folder and the commit. */
export function gitRepo(files: Record<string, string>): { dir: string; commit: string } {
  const dir = tempDir(files);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  return { dir, commit: git(dir, 'rev-parse', 'HEAD') };
}

export function commitAll(dir: string, message = 'change'): string {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', message);
  return git(dir, 'rev-parse', 'HEAD');
}

export const POD = (image: string, name = 'p'): string =>
  `apiVersion: v1\nkind: Pod\nmetadata:\n  name: ${name}\nspec:\n  containers:\n    - name: a\n      image: ${image}\n`;
