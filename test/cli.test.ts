import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../src/cli/main.js';

const fixture = fileURLToPath(new URL('./fixtures/web.yaml', import.meta.url));

function cli(...args: string[]) {
  let stdout = '';
  let stderr = '';
  const code = run(args, {
    stdout: (t) => (stdout += t),
    stderr: (t) => (stderr += t),
  });
  return { code, stdout, stderr };
}

describe('manifestlens explain', () => {
  it('prints each source line with its explanation', () => {
    const { code, stdout } = cli('explain', fixture);
    expect(code).toBe(0);
    expect(stdout).toContain('== Deployment "web" (apps/v1), document 1 of 2, line 1 ==');
    expect(stdout).toContain('== Service "web" (v1), document 2 of 2, line 26 ==');
    expect(stdout).toContain('19 |           image: nginx:1.27');
    expect(stdout).toContain('The container image to run');
  });

  it('prints help and exits 0', () => {
    const { code, stdout } = cli('--help');
    expect(code).toBe(0);
    expect(stdout).toContain('Usage: manifestlens explain <file>');
  });

  it('exits 2 with usage when the command or file is missing', () => {
    expect(cli().code).toBe(2);
    expect(cli('explain').code).toBe(2);
    expect(cli('explain').stderr).toContain('Usage:');
    expect(cli('frobnicate', fixture).code).toBe(2);
  });

  it('exits 2 for an unknown option', () => {
    const { code, stderr } = cli('explain', '--nope', fixture);
    expect(code).toBe(2);
    expect(stderr).toContain('Usage:');
  });

  it('exits 2 when the file cannot be read', () => {
    const { code, stderr } = cli('explain', join(fixture, 'missing.yaml'));
    expect(code).toBe(2);
    expect(stderr).toContain('Cannot read');
  });
});
