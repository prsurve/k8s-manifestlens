// @vitest-environment jsdom
import {
  checkManifest,
  diffManifests,
  explainManifest,
  fixManifest,
  loadBundledRules,
  unifiedDiff,
} from '@manifestlens/core';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createView,
  friendlyPath,
  renderCheck,
  renderDiff,
  renderExplain,
  renderFix,
} from '../src/render.js';

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
const click = (el: Element | null | undefined) => (el as HTMLElement | null | undefined)?.click();
const risky = 'kind: Pod\nspec:\n  containers:\n    - name: a\n      image: nginx\n';

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

  it('links each docs page once per object', () => {
    const yaml =
      'kind: Pod\nspec:\n  containers:\n    - name: a\n      image: x:1\n      resources:\n        limits:\n          memory: 1Gi\n          cpu: 1\n';
    const root = renderExplain(explainManifest(yaml), yaml);
    const hrefs = [...root.querySelectorAll('a.docs')].map((a) => a.getAttribute('href'));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('filters rows as you type, keeps the filter across re-renders, and counts matches', () => {
    const view = createView();
    const root = renderExplain(explainManifest(pod), pod, view);
    const input = root.querySelector<HTMLInputElement>('input.filter');
    expect(input).not.toBeNull();
    (input as HTMLInputElement).value = 'image';
    input?.dispatchEvent(new Event('input'));
    const visible = [...root.querySelectorAll<HTMLElement>('.row')].filter((r) => !r.hidden);
    expect(visible.length).toBe(1);
    expect(root.querySelector('.summary')?.textContent).toBe('1 of 5 fields');

    const again = renderExplain(explainManifest(pod), pod, view);
    expect(again.querySelector<HTMLInputElement>('input.filter')?.value).toBe('image');
    expect([...again.querySelectorAll<HTMLElement>('.row')].filter((r) => !r.hidden).length).toBe(
      1,
    );
  });

  it('toggles between compact and full explanations', () => {
    const view = createView();
    const root = renderExplain(explainManifest(pod), pod, view);
    const toggle = [...root.querySelectorAll('button')].find((b) =>
      /full text/i.test(b.textContent ?? ''),
    );
    expect(root.classList.contains('full')).toBe(false);
    click(toggle);
    expect(root.classList.contains('full')).toBe(true);
    expect(toggle?.textContent).toBe('Compact');
    expect(view.expandAll).toBe(true);
  });

  it('jumps to the line in the text box', () => {
    const jump = vi.fn();
    const root = renderExplain(explainManifest(pod), pod, createView(jump));
    click(root.querySelectorAll('button.ln')[4]);
    expect(jump).toHaveBeenCalledWith('main', 5);
    expect(root.querySelectorAll('button.ln')[4]?.getAttribute('aria-label')).toBe('Go to line 5');
  });

  it('keeps hostile YAML as text', () => {
    const root = renderExplain(explainManifest(hostile), hostile);
    expect(injected(root).length).toBe(0);
    expect(root.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('reports YAML errors and unsupported kinds', () => {
    const bad = 'kind: Pod\nspec: [oops\n';
    expect(renderExplain(explainManifest(bad), bad).querySelector('.issue')).not.toBeNull();
    const cm = 'kind: Certificate\ndata:\n  a: b\n';
    expect(renderExplain(explainManifest(cm), cm).textContent).toContain('No field explanations');
  });
});

describe('renderCheck', () => {
  const rules = loadBundledRules();

  it('lists findings one per row, collapsed, with why and fix inside', () => {
    const root = renderCheck(checkManifest(risky, rules));
    expect(root.querySelector('.summary')?.textContent).toMatch(/\d+ findings/);
    expect(root.querySelectorAll('.chip').length).toBe(3);
    const rows = root.querySelectorAll<HTMLDetailsElement>('details.finding');
    expect(rows.length).toBeGreaterThan(3);
    expect([...rows].every((d) => !d.open)).toBe(true);
    expect(root.querySelector('.finding .badge')?.textContent).toMatch(/error|warning|info/);
    expect(root.textContent).toContain('Why:');
    expect(root.textContent).toContain('Fix:');
  });

  it('says so when there is nothing to report', () => {
    const root = renderCheck(checkManifest('kind: ConfigMap\ndata: {}\n', rules));
    expect(root.querySelector('.summary')?.textContent).toBe('No issues found.');
    expect(root.querySelectorAll('.chip').length).toBe(0);
  });

  it('hides a severity when its chip is switched off, and remembers it', () => {
    const view = createView();
    const root = renderCheck(checkManifest(risky, rules), view);
    const chip = root.querySelector<HTMLButtonElement>('.chip.sev-warning');
    expect(chip?.getAttribute('aria-pressed')).toBe('true');
    click(chip);
    expect(chip?.getAttribute('aria-pressed')).toBe('false');
    expect(root.hasAttribute('data-hide-warning')).toBe(true);
    expect(view.hidden.has('warning')).toBe(true);
    const again = renderCheck(checkManifest(risky, rules), view);
    expect(again.hasAttribute('data-hide-warning')).toBe(true);
    expect(again.querySelector('.chip.sev-warning')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('expands and collapses everything, and remembers rows the user opened', () => {
    const view = createView();
    const root = renderCheck(checkManifest(risky, rules), view);
    const rows = () => [...root.querySelectorAll<HTMLDetailsElement>('details.finding')];
    const toggle = [...root.querySelectorAll('button')].find((b) =>
      /expand all/i.test(b.textContent ?? ''),
    );
    click(toggle);
    expect(rows().every((d) => d.open)).toBe(true);
    expect(toggle?.textContent).toBe('Collapse all');
    click(toggle);
    expect(rows().some((d) => d.open)).toBe(false);

    const first = rows()[0] as HTMLDetailsElement;
    first.open = true;
    first.dispatchEvent(new Event('toggle'));
    const again = renderCheck(checkManifest(risky, rules), view);
    expect(again.querySelectorAll<HTMLDetailsElement>('details.finding[open]').length).toBe(1);
  });

  it('jumps to the finding line from inside an opened row', () => {
    const jump = vi.fn();
    const root = renderCheck(checkManifest(risky, rules), createView(jump));
    const button = [...root.querySelectorAll('.detail button')].find((b) =>
      /Go to line/.test(b.textContent ?? ''),
    );
    click(button);
    expect(jump).toHaveBeenCalledWith('main', expect.any(Number));
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
    const removed = renderDiff(diffManifests(old, dropped, []));
    expect(removed.querySelector('.ch-removed .ln')?.getAttribute('aria-label')).toContain(
      'old version',
    );
  });

  it('shows before and after values compactly', () => {
    const root = renderDiff(diffManifests(old, old.replace('2', '5'), []));
    expect(root.querySelector('.change del')?.textContent).toBe('2');
    expect(root.querySelector('.change ins')?.textContent).toBe('5');
  });

  it('keeps new findings collapsed under one line, with a count', () => {
    const bad =
      'kind: Pod\nmetadata:\n  name: p\nspec:\n  containers:\n    - name: a\n      image: nginx\n';
    const root = renderDiff(diffManifests(bad.replace('nginx', 'nginx:1'), bad));
    const group = root.querySelector<HTMLDetailsElement>('details.group');
    expect(group?.open).toBe(false);
    expect(group?.querySelector('summary')?.textContent).toMatch(/New findings \(\d+\)/);
    expect(root.querySelector('.doc-body > summary')?.textContent).toMatch(/new finding/);
  });

  it('lists added objects and hides unchanged ones', () => {
    const next = `${old}---\nkind: Service\nmetadata:\n  name: new\n`;
    const root = renderDiff(diffManifests(old, next, []));
    expect(root.textContent).toContain('1 added');
    expect(root.querySelectorAll('.doc').length).toBe(1);
    expect(renderDiff(diffManifests(old, old, [])).querySelectorAll('.doc').length).toBe(0);
  });

  it('jumps to the new or the old version', () => {
    const jump = vi.fn();
    const dropped = 'kind: Deployment\nmetadata:\n  name: web\nspec:\n  paused: true\n';
    const root = renderDiff(diffManifests(old, dropped, []), createView(jump));
    click(root.querySelector('.ch-removed .ln'));
    expect(jump).toHaveBeenLastCalledWith('old', expect.any(Number));
    click(root.querySelector('.ch-added .ln'));
    expect(jump).toHaveBeenLastCalledWith('new', expect.any(Number));
  });

  it('keeps hostile YAML as text', () => {
    const changed = `${hostile}  extra: 1\n`;
    const result = diffManifests(hostile, changed, loadBundledRules());
    expect(injected(renderDiff(result)).length).toBe(0);
  });
});

describe('friendlyPath', () => {
  const change = (path: string, within: { list: string; name: string }[] = []) =>
    ({ type: 'changed', path, pattern: path, line: 1, within }) as never;

  it('names list items and drops the Pod template wrapper', () => {
    expect(
      friendlyPath(
        change('spec.template.spec.containers[1].env[1].value', [
          { list: 'containers', name: 'web' },
          { list: 'env', name: 'LOG_LEVEL' },
        ]),
      ),
    ).toBe('containers[web].env[LOG_LEVEL].value');
    expect(friendlyPath(change('spec.replicas'))).toBe('replicas');
    expect(
      friendlyPath(
        change('spec.jobTemplate.spec.template.spec.containers[0].image', [
          { list: 'containers', name: 'a' },
        ]),
      ),
    ).toBe('containers[a].image');
    expect(friendlyPath(change('metadata.labels.app'))).toBe('metadata.labels.app');
  });

  it('keeps an index when the item has no name', () => {
    expect(friendlyPath(change('spec.ports[0].port'))).toBe('ports[0].port');
  });
});

describe('stylesheet', () => {
  it('lets the hidden attribute win over component display rules', () => {
    // jsdom does not apply CSS, so check the rule that makes `row.hidden = true` work in a browser.
    const css = readFileSync(join(process.cwd(), 'apps/web/src/style.css'), 'utf8');
    expect(css).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  });
});

describe('renderFix', () => {
  const rules = loadBundledRules();
  const pod =
    'kind: Pod\nmetadata:\n  name: "<img src=x onerror=alert(1)>"\nspec:\n  containers:\n    - name: "<b>c</b>"\n      image: x:1\n';

  it('lists the fixes, the diff and a copy button, and never turns YAML into markup', () => {
    const result = fixManifest(pod, rules, { only: ['allow-privilege-escalation'] });
    const copy = vi.fn();
    const apply = vi.fn();
    const root = renderFix(result, unifiedDiff(result.original, result.fixed), { copy, apply });
    expect(root.textContent).toContain('1 fix ready');
    expect(root.textContent).toContain('allowPrivilegeEscalation: false');
    expect(root.querySelectorAll('.dl-add').length).toBeGreaterThan(0);
    expect(root.querySelector('details.risk-low .badge')?.textContent).toBe('low risk');
    expect(injected(root).length).toBe(0);
    const buttons = [...root.querySelectorAll('button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Apply to input', 'Copy fixed manifest']);
    click(buttons[0]);
    expect(apply).toHaveBeenCalledWith(result.fixed);
    click(buttons[1]);
    expect(copy).toHaveBeenCalledWith(result.fixed);
  });

  it('offers undo only when given one, and never applies by itself', () => {
    const result = fixManifest(pod, rules, { only: ['allow-privilege-escalation'] });
    const apply = vi.fn();
    const undo = vi.fn();
    const root = renderFix(result, '', { apply, undo });
    expect(apply).not.toHaveBeenCalled();
    const labels = [...root.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toContain('Undo last apply');
    click([...root.querySelectorAll('button')].find((b) => b.textContent === 'Undo last apply'));
    expect(undo).toHaveBeenCalled();
    const none = fixManifest(pod, rules, { only: ['missing-memory-limit'], maxRisk: 'medium' });
    expect(renderFix(none, '', { undo }).querySelector('button')?.textContent).toBe(
      'Undo last apply',
    );
  });

  it('says why fixes were held back', () => {
    const result = fixManifest(pod, rules, { only: ['missing-memory-limit'], maxRisk: 'medium' });
    const root = renderFix(result, '');
    expect(root.textContent).toContain('No fixes to apply');
    expect(root.textContent).toContain('memoryLimit');
    expect(root.querySelector('.issue.risk-medium .badge')?.textContent).toBe('medium risk');
  });
});
