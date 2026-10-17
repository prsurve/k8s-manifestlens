import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../src/main.js';

const fixture = fileURLToPath(new URL('../../../examples/web.yaml', import.meta.url));

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
    expect(stdout).toContain('manifestlens explain <file>');
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

describe('manifestlens check', () => {
  const risky = fileURLToPath(new URL('../../../examples/risky.yaml', import.meta.url));
  const hardened = fileURLToPath(new URL('../../../examples/hardened.yaml', import.meta.url));

  it('reports findings with line numbers and exits 1 on errors', () => {
    const { code, stdout } = cli('check', risky);
    expect(code).toBe(1);
    expect(stdout).toContain('line 17  ERROR  privileged-container');
    expect(stdout).toContain('Fix:');
    expect(stdout).toMatch(/\d+ findings: 2 error, /);
  });

  it('exits 0 and says so when nothing is wrong', () => {
    const { code, stdout } = cli('check', hardened);
    expect(code).toBe(0);
    expect(stdout).toContain('No issues found.');
    expect(stdout).toContain('0 findings: 0 error, 0 warning, 0 info');
  });

  it('honours --fail-on', () => {
    const noErrors = (extra: string[]) => cli('check', hardened, ...extra).code;
    expect(noErrors(['--fail-on', 'info'])).toBe(0);
    expect(cli('check', risky, '--fail-on', 'none').code).toBe(0);
    expect(cli('check', risky, '--fail-on', 'bogus').code).toBe(2);
  });

  it('loads extra rules from a file or directory', () => {
    const dir = fileURLToPath(new URL('./fixtures/custom-rules/', import.meta.url));
    for (const target of [dir, join(dir, 'team.yaml')]) {
      const { code, stdout } = cli('check', hardened, '--rules', target);
      expect(stdout).toContain('team-needs-owner-label');
      expect(code).toBe(0); // the custom rule is only a warning
    }
  });

  it('rejects broken or duplicate rules with exit 2', () => {
    const bad = join(
      fileURLToPath(new URL('./fixtures/custom-rules/', import.meta.url)),
      'nope.yaml',
    );
    expect(cli('check', hardened, '--rules', bad).code).toBe(2);
    const dup = fileURLToPath(new URL('./fixtures/duplicate-rule.yaml', import.meta.url));
    const { code, stderr } = cli('check', hardened, '--rules', dup);
    expect(code).toBe(2);
    expect(stderr).toContain('Duplicate rule id "single-replica"');
  });
});

describe('manifestlens diff', () => {
  const cli = (...args: string[]) => {
    let stdout = '';
    let stderr = '';
    const code = run(args, { stdout: (t) => (stdout += t), stderr: (t) => (stderr += t) });
    return { code, stdout, stderr };
  };
  const example = (name: string) =>
    fileURLToPath(new URL(`../../../examples/${name}`, import.meta.url));
  const oldF = example('diff-old.yaml');
  const newF = example('diff-new.yaml');

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
    const missing = cli('diff', oldF, example('nope.yaml'));
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain('Cannot read');
  });
});

describe('explain docs links', () => {
  it('prints each docs link once per document', () => {
    const { stdout } = cli(
      'explain',
      fileURLToPath(new URL('../../../examples/hardened.yaml', import.meta.url)),
    );
    expect((stdout.match(/Docs: \S+/g) ?? []).length).toBeGreaterThan(3);
    const deployment = stdout.split('== Service')[0] ?? '';
    const links = deployment.match(/Docs: \S+/g) ?? [];
    expect(new Set(links).size).toBe(links.length);
  });
});
