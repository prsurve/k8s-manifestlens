import { describe, expect, it } from 'vitest';
import { Problems, suggest } from '../src/coerce.js';
import {
  DEFAULTS,
  INPUT_NAMES,
  parseConfig,
  parseInputs,
  resolveSettings,
  thresholds,
  validateSettings,
} from '../src/settings.js';

const inputs = (raw: Record<string, string>) => {
  const p = new Problems();
  const layer = parseInputs(raw, p);
  return { layer, problems: p.items };
};
const config = (data: unknown) => {
  const p = new Problems();
  const layer = parseConfig(data, '.github/k8s-manifestlens.yml', p);
  return { layer, problems: p.items };
};

describe('precedence: defaults < config file < workflow inputs', () => {
  it('uses the built-in defaults when nothing is set', () => {
    const { settings, sources } = resolveSettings({}, {});
    expect(settings).toEqual(DEFAULTS);
    expect(Object.values(sources).every((s) => s === 'default')).toBe(true);
  });

  it('lets the config file override the defaults', () => {
    const { settings, sources } = resolveSettings(
      config({ 'fail-on': 'warning', scope: 'new' }).layer,
      {},
    );
    expect(settings.failOn).toBe('warning');
    expect(settings.scope).toBe('new');
    expect(sources.failOn).toBe('config');
    expect(sources.mode).toBe('default');
  });

  it('lets a workflow input override the config file', () => {
    const { settings, sources } = resolveSettings(
      config({ 'fail-on': 'warning', mode: 'enforce' }).layer,
      inputs({ 'fail-on': 'error', mode: 'report' }).layer,
    );
    expect(settings.failOn).toBe('error');
    expect(settings.mode).toBe('report');
    expect(sources.failOn).toBe('input');
  });

  it('treats an empty input as not set, so the config file still applies', () => {
    const { settings } = resolveSettings(
      config({ 'fail-on': 'warning' }).layer,
      inputs({ 'fail-on': '', mode: '' }).layer,
    );
    expect(settings.failOn).toBe('warning');
  });

  it('can tell "set to the default value" from "not set"', () => {
    // The input says error (the default). The config says warning. The explicit input must win.
    const { settings } = resolveSettings(
      config({ 'fail-on': 'warning' }).layer,
      inputs({ 'fail-on': 'error' }).layer,
    );
    expect(settings.failOn).toBe('error');
  });

  it('replaces a list from a lower level, but adds up the rule lists', () => {
    const { settings, sources } = resolveSettings(
      config({ paths: ['a/**'], 'disable-rules': ['one'], ignore: [{ path: 'x/**' }] }).layer,
      inputs({ paths: 'b/**', 'disable-rules': 'two, one' }).layer,
    );
    expect(settings.paths).toEqual(['b/**']);
    expect(settings.disableRules).toEqual(['one', 'two']);
    expect(settings.ignore).toEqual([{ path: 'x/**' }]);
    expect(sources.disableRules).toBe('config+input');
    expect(sources.paths).toBe('input');
  });

  it('merges severity overrides key by key, with the input winning', () => {
    const { settings } = resolveSettings(
      config({ 'severity-overrides': { a: 'warning', b: 'off' } }).layer,
      inputs({ 'severity-overrides': 'a=error\nc: info' }).layer,
    );
    expect(settings.severityOverrides).toEqual({ a: 'error', b: 'off', c: 'info' });
  });
});

describe('reading workflow inputs', () => {
  it('parses every kind of input', () => {
    const { layer, problems } = inputs({
      paths: 'k8s/**\n!k8s/old/**',
      'fail-on': 'WARNING',
      'max-errors': '3',
      'max-total': '0',
      'fail-on-parse-error': 'false',
      'dry-run': 'TRUE',
      'disable-rules': 'a, b\nc',
      'max-annotations': '10',
    });
    expect(problems).toEqual([]);
    expect(layer).toMatchObject({
      paths: ['k8s/**', '!k8s/old/**'],
      failOn: 'warning',
      maxErrors: 3,
      maxTotal: 0,
      failOnParseError: false,
      dryRun: true,
      disableRules: ['a', 'b', 'c'],
      maxAnnotations: 10,
    });
  });

  it('does not split paths on commas, because globs use them', () => {
    expect(inputs({ paths: 'k8s/{a,b}/*.yaml' }).layer.paths).toEqual(['k8s/{a,b}/*.yaml']);
  });

  it('reports every problem at once, naming the input and the allowed values', () => {
    const { problems } = inputs({
      scope: 'sideways',
      'fail-on': 'bogus',
      'max-errors': '-3',
      mode: 'loud',
      'dry-run': 'maybe',
      'max-warnings': 'many',
    });
    expect(problems).toHaveLength(6);
    expect(problems.join('\n')).toContain(
      'scope: "sideways" is not valid. Use one of: all, changed, new.',
    );
    expect(problems.join('\n')).toContain('max-errors: "-3" must be a whole number');
    expect(problems.join('\n')).toContain('dry-run: "maybe" must be true or false.');
  });

  it('rejects malformed severity overrides', () => {
    expect(inputs({ 'severity-overrides': 'just-a-word' }).problems[0]).toContain(
      'should look like rule-id=severity',
    );
    expect(inputs({ 'severity-overrides': 'rule=loud' }).problems[0]).toContain(
      'severity-overrides.rule',
    );
  });

  it('knows an input name for every setting except the structured ignore list', () => {
    expect(INPUT_NAMES).toContain('fail-on');
    expect(INPUT_NAMES).not.toContain('ignore');
  });
});

describe('reading the config file', () => {
  it('reads every setting, including the ignore list', () => {
    const { layer, problems } = config({
      version: 1,
      scope: 'new',
      'max-warnings': 10,
      annotations: false,
      ignore: [
        { path: 'k8s/jobs/**', rules: ['missing-readiness-probe'] },
        { rule: 'image-latest-tag' },
      ],
    });
    expect(problems).toEqual([]);
    expect(layer).toMatchObject({ scope: 'new', maxWarnings: 10, annotations: false });
    expect(layer.ignore).toEqual([
      { path: 'k8s/jobs/**', rules: ['missing-readiness-probe'] },
      { rules: ['image-latest-tag'] },
    ]);
  });

  it('treats an empty file as no settings', () => {
    expect(config(null)).toEqual({ layer: {}, problems: [] });
  });

  it('rejects unknown settings and suggests the likely typo', () => {
    const { problems } = config({ 'fail-onn': 'error', mod: 'report', bogus: 1 });
    expect(problems).toContain(
      '.github/k8s-manifestlens.yml: unknown setting "fail-onn" (did you mean "fail-on"?).',
    );
    expect(problems.some((p) => p.includes('"mod"') && p.includes('"mode"'))).toBe(true);
    expect(problems.some((p) => p.includes('"bogus"') && !p.includes('did you mean'))).toBe(true);
  });

  it('rejects the wrong types with the setting name', () => {
    const { problems } = config({
      'fail-on': 5,
      paths: 'not-a-list-but-ok',
      'max-errors': 'x',
      ignore: 'nope',
    });
    expect(problems.join('\n')).toContain('fail-on: "5" is not valid');
    expect(problems.join('\n')).toContain('ignore: must be a list');
  });

  it('rejects bad ignore entries and unsupported versions', () => {
    expect(config({ ignore: [{ pth: 'x' }] }).problems.join('\n')).toContain(
      'unknown key "pth" (did you mean "path"?)',
    );
    expect(config({ ignore: [{}] }).problems.join('\n')).toContain(
      'needs "path", "rules", or both',
    );
    expect(config({ version: 2 }).problems.join('\n')).toContain('version 2 is not supported');
    expect(config([1, 2]).problems[0]).toContain('must be a mapping');
  });
});

describe('thresholds', () => {
  const settingsWith = (patch: Record<string, unknown>) =>
    resolveSettings({}, patch as never).settings;

  it('derives what is allowed from fail-on', () => {
    expect(thresholds(settingsWith({ failOn: 'error' }))).toEqual({
      error: 0,
      warning: null,
      info: null,
      total: null,
    });
    expect(thresholds(settingsWith({ failOn: 'warning' }))).toEqual({
      error: 0,
      warning: 0,
      info: null,
      total: null,
    });
    expect(thresholds(settingsWith({ failOn: 'info' }))).toEqual({
      error: 0,
      warning: 0,
      info: 0,
      total: null,
    });
    expect(thresholds(settingsWith({ failOn: 'none' }))).toEqual({
      error: null,
      warning: null,
      info: null,
      total: null,
    });
  });

  it('lets an explicit limit win over fail-on in both directions', () => {
    expect(thresholds(settingsWith({ failOn: 'warning', maxWarnings: 10 })).warning).toBe(10);
    expect(thresholds(settingsWith({ failOn: 'none', maxErrors: 2 })).error).toBe(2);
    expect(thresholds(settingsWith({ failOn: 'error', maxInfo: 0 })).info).toBe(0);
    expect(thresholds(settingsWith({ maxTotal: 7 })).total).toBe(7);
  });
});

describe('validateSettings', () => {
  const check = (patch: Record<string, unknown>) =>
    validateSettings(resolveSettings({}, patch as never).settings);

  it('accepts the defaults', () => {
    expect(check({})).toEqual([]);
  });

  it('rejects paths that escape the repository', () => {
    expect(check({ workingDirectory: '../other' })[0]).toContain('working-directory');
    expect(check({ configFile: '/etc/passwd' })[0]).toContain('config-file');
    expect(check({ sarifFile: 'a/../../b.sarif' })[0]).toContain('sarif-file');
    expect(check({ rules: ['../rules'] })[0]).toContain('rules');
  });

  it('rejects unusable patterns, labels and refs', () => {
    expect(check({ paths: [] })[0]).toContain('at least one pattern');
    expect(check({ paths: ['!only-excludes/**'] })[0]).toContain('not an exclusion');
    expect(check({ label: '<script>' })[0]).toContain('label');
    expect(check({ label: 'a'.repeat(65) })[0]).toContain('label');
    expect(check({ baseRef: '--upload-pack=evil' })[0]).toContain('base-ref');
    expect(check({ baseRef: 'origin/main' })).toEqual([]);
    expect(check({ label: 'prod / eu-west' })).toEqual([]);
  });
});

describe('suggest', () => {
  it('finds a close name, and nothing for a far one', () => {
    expect(suggest('fail-onn', ['fail-on', 'mode'])).toBe('fail-on');
    expect(suggest('zzzzzz', ['fail-on', 'mode'])).toBeUndefined();
  });
});
