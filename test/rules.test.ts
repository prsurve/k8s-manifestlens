import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RuleError, checkManifest, loadBundledRules, parseRules } from '../src/core/index.js';
import { bundledRuleSources } from '../src/core/rules/bundled.js';

const read = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const rulesDir = new URL('../rules/', import.meta.url);

function findingsFor(rule: string, yaml: string) {
  const rules = parseRules(rule);
  return checkManifest(yaml, rules).documents.flatMap((d) => d.findings);
}

describe('bundled rules', () => {
  const rules = loadBundledRules();

  it('are in sync with rules/*.yaml (run `npm run bundle-rules` after editing)', () => {
    const files = readdirSync(rulesDir)
      .filter((f) => f.endsWith('.yaml'))
      .sort();
    expect(Object.keys(bundledRuleSources).sort()).toEqual(files);
    for (const f of files) {
      expect(bundledRuleSources[f]).toBe(readFileSync(new URL(f, rulesDir), 'utf8'));
    }
  });

  it('have unique ids and a why and fix for beginners', () => {
    expect(new Set(rules.map((r) => r.id)).size).toBe(rules.length);
    expect(rules.length).toBeGreaterThanOrEqual(15);
    for (const r of rules) {
      expect(r.why, r.id).toBeTruthy();
      expect(r.fix, r.id).toBeTruthy();
    }
  });

  it('all fire on the risky fixture', () => {
    const fired = new Set(
      checkManifest(read('risky.yaml'), rules).documents.flatMap((d) =>
        d.findings.map((f) => f.ruleId),
      ),
    );
    expect([...fired].sort()).toEqual(rules.map((r) => r.id).sort());
  });

  it('report nothing on the hardened fixture', () => {
    const findings = checkManifest(read('hardened.yaml'), rules).documents.flatMap(
      (d) => d.findings,
    );
    expect(findings).toEqual([]);
  });

  it('point at the line of the offending field', () => {
    const [deployment] = checkManifest(read('risky.yaml'), rules).documents;
    const line = (id: string) => deployment?.findings.find((f) => f.ruleId === id)?.line;
    expect(line('privileged-container')).toBe(17);
    expect(line('run-as-root-user')).toBe(18);
    expect(line('image-latest-tag')).toBe(15);
    expect(line('hostpath-volume')).toBe(11);
    expect(line('host-namespaces')).toBe(8);
    expect(line('missing-memory-limit')).toBe(14); // no resources block: falls back to the container
  });
});

describe('image tag rule', () => {
  const image = (value: string) =>
    findingsFor(
      readFileSync(new URL('container.yaml', rulesDir), 'utf8'),
      `kind: Pod\nspec:\n  containers:\n    - name: a\n      image: ${value}\n`,
    ).some((f) => f.ruleId === 'image-latest-tag');

  it.each(['nginx', 'nginx:latest', 'ghcr.io/org/app', 'localhost:5000/app', 'a/b:latest'])(
    'flags %s',
    (value) => expect(image(value)).toBe(true),
  );
  it.each(['nginx:1.27', 'localhost:5000/app:2', 'nginx@sha256:abc123', 'app:1.0@sha256:abc'])(
    'allows %s',
    (value) => expect(image(value)).toBe(false),
  );
});

describe('rule language', () => {
  const rule = (when: string, extra = '') =>
    `id: t\ntitle: T\nseverity: info\nkinds: [Pod]\nmessage: m\n${extra}when:\n${when}\n`;
  const pod =
    'kind: Pod\nspec:\n  hostNetwork: true\n  nodeSelector:\n    disk: ssd\n  list: [a, b]\n';
  const hits = (when: string) => findingsFor(rule(when), pod).length;

  it('supports missing, present, equals, in, contains and matches', () => {
    expect(hits('  missing: spec.nope')).toBe(1);
    expect(hits('  missing: spec.hostNetwork')).toBe(0);
    expect(hits('  present: spec.hostNetwork')).toBe(1);
    expect(hits('  equals: { spec.hostNetwork: true }')).toBe(1);
    expect(hits('  equals: { spec.hostNetwork: "true" }')).toBe(0);
    expect(hits('  in: { spec.nodeSelector.disk: [hdd, ssd] }')).toBe(1);
    expect(hits('  contains: { spec.list: b }')).toBe(1);
    expect(hits('  matches: { spec.nodeSelector.disk: "^s" }')).toBe(1);
  });

  it('combines conditions with all, any and not', () => {
    expect(hits('  all: [{ present: spec.hostNetwork }, { missing: spec.nope }]')).toBe(1);
    expect(hits('  all: [{ present: spec.hostNetwork }, { present: spec.nope }]')).toBe(0);
    expect(hits('  any: [{ present: spec.nope }, { present: spec.hostNetwork }]')).toBe(1);
    expect(hits('  not: { present: spec.hostNetwork }')).toBe(0);
  });

  it('only applies to the listed kinds', () => {
    const r = rule('  missing: spec.nope');
    expect(findingsFor(r, 'kind: Service\nspec: {}\n')).toEqual([]);
    expect(findingsFor(r.replace('[Pod]', "['*']"), 'kind: Service\nspec: {}\n')).toHaveLength(1);
  });

  it('fills message placeholders and uses report for the line', () => {
    const r = rule('  present: spec.hostNetwork', 'report: spec.nodeSelector.disk\n').replace(
      'message: m',
      'message: "{kind} {name} {value}"',
    );
    const [f] = findingsFor(r, 'kind: Pod\nmetadata:\n  name: p\n' + pod.slice(10));
    expect(f).toMatchObject({ message: 'Pod p ssd', line: 7, path: 'spec.nodeSelector.disk' });
  });
});

describe('parseRules validation', () => {
  const base = 'id: ok\ntitle: T\nseverity: info\nkinds: [Pod]\nmessage: m\nwhen: { missing: a }\n';

  it('accepts several rules in one file', () => {
    expect(parseRules(`${base}---\n${base.replace('id: ok', 'id: ok-two')}`)).toHaveLength(2);
  });

  it.each([
    ['unknown key', `${base}sevrity: x\n`, /unknown key "sevrity"/],
    ['bad severity', base.replace('info', 'loud'), /severity/],
    ['bad id', base.replace('id: ok', 'id: Not Ok'), /"id"/],
    ['missing when', base.replace('when: { missing: a }\n', ''), /"when" is required/],
    ['unknown operator', base.replace('missing: a', 'exists: a'), /unknown operator "exists"/],
    ['two operators', base.replace('{ missing: a }', '{ missing: a, present: b }'), /exactly one/],
    ['bad regex', base.replace('{ missing: a }', '{ matches: { a: "(" } }'), /regular expression/],
    ['bad scope', `${base}scope: galaxy\n`, /scope/],
    ['bad yaml', 'id: [oops\n', /./],
  ])('rejects %s', (_name, text, message) => {
    expect(() => parseRules(text, 'my.yaml')).toThrow(RuleError);
    expect(() => parseRules(text, 'my.yaml')).toThrow(message);
  });

  it('names the file and rule in errors', () => {
    expect(() => parseRules(`${base}extra: 1\n`, 'my.yaml')).toThrow(/my\.yaml: rule "ok"/);
  });
});
