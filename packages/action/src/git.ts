import { execFileSync } from 'node:child_process';

export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitError';
  }
}

/** Run git without a shell, so nothing in a branch or file name can be read as a command. */
function git(cwd: string, args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const stderr = (err as { stderr?: Buffer | string }).stderr?.toString().trim();
    throw new GitError(stderr || (err instanceof Error ? err.message : String(err)));
  }
}

/** The full commit a ref points to, or null if this checkout does not have it. */
export function resolveCommit(cwd: string, ref: string): string | null {
  try {
    return (
      git(cwd, [
        'rev-parse',
        '--verify',
        '--quiet',
        '--end-of-options',
        `${ref}^{commit}`,
      ]).trim() || null
    );
  } catch {
    return null;
  }
}

/** Files this change touches: new path mapped to its old path, or null if the file is new. */
export function changedFiles(cwd: string, base: string): Map<string, string | null> {
  const run = (range: string[]): string =>
    git(cwd, ['diff', '--name-status', '-M', '-z', '--diff-filter=ACMR', ...range, '--']);
  let out: string;
  try {
    // The merge base is what a pull request is compared against.
    out = run([`${base}...HEAD`]);
  } catch {
    out = run([base, 'HEAD']);
  }

  const tokens = out.split('\0').filter((t) => t !== '');
  const result = new Map<string, string | null>();
  for (let i = 0; i < tokens.length;) {
    const status = tokens[i++] as string;
    if (status.startsWith('R') || status.startsWith('C')) {
      const from = tokens[i++] as string;
      const to = tokens[i++] as string;
      result.set(to, status.startsWith('R') ? from : null);
    } else {
      result.set(tokens[i++] as string, null);
    }
  }
  return result;
}

/** A file as it was at a commit, or null if it did not exist there. */
export function fileAt(cwd: string, commit: string, path: string): string | null {
  try {
    return git(cwd, ['show', `${commit}:${path}`]);
  } catch {
    return null;
  }
}
