import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { Problems } from '../src/coerce.js';
import { INPUT_NAMES, parseConfig, resolveSettings, validateSettings } from '../src/settings.js';

const repoFile = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), 'utf8');
const action = parse(repoFile('action.yml')) as {
  inputs: Record<string, { description?: string; default?: string; required?: boolean }>;
  outputs: Record<string, { description?: string }>;
  runs: { using: string; main: string };
};

describe('action.yml matches the code', () => {
  it('declares exactly the inputs the code reads, plus the token', () => {
    expect(Object.keys(action.inputs).sort()).toEqual([...INPUT_NAMES, 'github-token'].sort());
  });

  it('has no default on any setting, so "not set" can be told from "set to the default"', () => {
    for (const [name, input] of Object.entries(action.inputs)) {
      if (name === 'github-token') expect(input.default).toBe('${{ github.token }}');
      else expect(input.default, name).toBeUndefined();
    }
  });

  it('describes every input and output, and requires none', () => {
    for (const [name, input] of Object.entries({ ...action.inputs, ...action.outputs })) {
      expect(input.description?.length, name).toBeGreaterThan(10);
    }
    expect(Object.values(action.inputs).some((i) => i.required)).toBe(false);
  });

  it('runs the committed bundle', () => {
    expect(action.runs.main).toBe('packages/action/dist/index.js');
    expect(action.runs.using).toMatch(/^node\d+$/);
  });

  it('documents every output the action sets', () => {
    expect(Object.keys(action.outputs).sort()).toEqual(
      [
        'errors',
        'files-checked',
        'fix-patch-file',
        'findings',
        'fixes-available',
        'infos',
        'parse-errors',
        'passed',
        'report-file',
        'result',
        'sarif-file',
        'suppressed',
        'warnings',
      ].sort(),
    );
  });
});

describe('the sample config', () => {
  it('is accepted by the action, and produces valid settings', () => {
    const p = new Problems();
    const layer = parseConfig(
      parse(repoFile('examples/manifestlens.config.yml')),
      'examples/manifestlens.config.yml',
      p,
    );
    expect(p.items).toEqual([]);
    const { settings } = resolveSettings(layer, {});
    expect(validateSettings(settings)).toEqual([]);
    expect(settings).toMatchObject({
      scope: 'new',
      failOn: 'warning',
      maxWarnings: 5,
      maxTotal: 25,
    });
    expect(settings.ignore).toHaveLength(2);
    expect(settings.severityOverrides).toEqual({
      'single-replica': 'warning',
      'writable-root-filesystem': 'off',
    });
  });

  it('uses only settings that are documented as inputs, apart from ignore and version', () => {
    const keys = Object.keys(parse(repoFile('examples/manifestlens.config.yml')) as object);
    for (const key of keys) expect([...INPUT_NAMES, 'ignore', 'version']).toContain(key);
  });
});

describe('the sample workflow', () => {
  const workflow = parse(repoFile('examples/workflows/manifestlens.yml')) as {
    jobs: Record<string, { steps: { uses?: string; with?: Record<string, string> }[] }>;
  };

  it('passes only inputs the action has', () => {
    const used = Object.values(workflow.jobs)
      .flatMap((job) => job.steps)
      .filter((step) => step.uses?.startsWith('prsurve/manifestlens@'))
      .flatMap((step) => Object.keys(step.with ?? {}));
    expect(used.length).toBeGreaterThan(5);
    for (const name of used) expect(Object.keys(action.inputs), name).toContain(name);
  });
});

describe('the self-test workflow', () => {
  it('passes only inputs the action has', () => {
    const wf = parse(repoFile('.github/workflows/action-selftest.yml')) as {
      jobs: Record<string, { steps: { uses?: string; with?: Record<string, string> }[] }>;
    };
    const used = Object.values(wf.jobs)
      .flatMap((job) => job.steps)
      .filter((step) => step.uses === './')
      .flatMap((step) => Object.keys(step.with ?? {}));
    for (const name of used) expect(Object.keys(action.inputs), name).toContain(name);
  });
});
