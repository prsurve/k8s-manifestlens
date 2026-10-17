// @vitest-environment jsdom
import {
  checkManifest,
  diffManifests,
  explainManifest,
  loadBundledRules,
} from '@manifestlens/core';
import { describe, expect, it } from 'vitest';
import { renderCheck, renderDiff, renderExplain } from '../src/render.js';

const hostile = [
  'kind: Pod',
  'metadata:',
  '  name: "<img src=x onerror=alert(1)>"',
  '  labels:',
  '    "<b>k</b>": "<script>alert(1)</script>"',
  'spec:',
  '  containers:',
  '    - name: "<i>c</i>"',
  '      image: "<svg onload=alert(1)>"',
  '',
].join('\n');

const injected = (root: HTMLElement) => root.querySelectorAll('img, script, svg, b, i, iframe');

describe('renderExplain', () => {
  const pod = 'kind: Pod\nspec:\n  containers:\n    - name: a\n      image: nginx:1.27\n';

  it('shows each field with its explanation and a docs link', () => {
    const root = renderExplain(explainManifest(pod), pod);
    expect(root.querySelectorAll('.row').length).toBe(5);
    expect(root.textContent).toContain('The container image to run');
    const link = root.querySelector('a.docs');
    expect(link?.getAttribute('href')).toMatch(/^https:\/\/kubernetes\.io\/docs\//);
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('keeps hostile YAML as text', () => {
    const root = renderExplain(explainManifest(hostile), hostile);
    expect(injected(root).length).toBe(0);
    expect(root.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('reports YAML errors and unsupported kinds', () => {
    const bad = 'kind: Pod\nspec: [oops\n';
    expect(renderExplain(explainManifest(bad), bad).querySelector('.issue')).not.toBeNull();
    const cm = 'kind: ConfigMap\ndata:\n  a: b\n';
    expect(renderExplain(explainManifest(cm), cm).textContent).toContain('No field explanations');
  });
});

describe('renderCheck', () => {
  const rules = loadBundledRules();

  it('summarises findings by severity with why and fix', () => {
    const risky = 'kind: Pod\nspec:\n  containers:\n    - name: a\n      image: nginx\n';
    const root = renderCheck(checkManifest(risky, rules));
    expect(root.querySelector('.summary')?.textContent).toMatch(/\d+ findings/);
    expect(root.querySelectorAll('.chip').length).toBe(3);
    expect(root.querySelector('.finding .badge')?.textContent).toMatch(/error|warning|info/);
    expect(root.textContent).toContain('Why:');
    expect(root.textContent).toContain('Fix:');
  });

  it('says so when there is nothing to report', () => {
    const root = renderCheck(checkManifest('kind: ConfigMap\ndata: {}\n', rules));
    expect(root.querySelector('.summary')?.textContent).toBe('No issues found.');
  });

  it('keeps hostile YAML as text', () => {
    expect(injected(renderCheck(checkManifest(hostile, rules))).length).toBe(0);
  });
});

describe('renderDiff', () => {
  const old = 'kind: Deployment\nmetadata:\n  name: web\nspec:\n  replicas: 2\n';

  it('shows effects and marks removed lines as coming from the old file', () => {
    const root = renderDiff(diffManifests(old, old.replace('2', '5'), []));
    expect(root.textContent).toContain('Scales up from 2 to 5');
    expect(root.querySelector('.st-changed')?.textContent).toBe('changed');
    const dropped = 'kind: Deployment\nmetadata:\n  name: web\nspec: {}\n';
    expect(renderDiff(diffManifests(old, dropped, [])).textContent).toContain('(old file)');
  });

  it('lists added objects and hides unchanged ones', () => {
    const next = `${old}---\nkind: Service\nmetadata:\n  name: new\n`;
    const root = renderDiff(diffManifests(old, next, []));
    expect(root.textContent).toContain('1 added');
    expect(root.querySelectorAll('.doc').length).toBe(1);
    expect(renderDiff(diffManifests(old, old, [])).querySelectorAll('.doc').length).toBe(0);
  });

  it('keeps hostile YAML as text', () => {
    const changed = `${hostile}  extra: 1\n`;
    const result = diffManifests(hostile, changed, loadBundledRules());
    expect(injected(renderDiff(result)).length).toBe(0);
  });
});
