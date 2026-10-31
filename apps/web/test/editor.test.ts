// @vitest-environment jsdom
import {
  checkManifest,
  diffManifests,
  explainManifest,
  fixManifest,
  loadBundledRules,
} from '@k8s-manifestlens/core';
import { describe, expect, it } from 'vitest';
import {
  caretLine,
  describeMeta,
  enhanceTextarea,
  manifestInfo,
  tokenizeLine,
} from '../src/editor.js';
import { exampleRules, quickStarts } from '../src/examples.js';
import { parseRules } from '@k8s-manifestlens/core';
import {
  containersOf,
  createView,
  renderCheck,
  renderDiff,
  renderExplain,
  renderOverview,
  renderSuggestions,
} from '../src/render.js';

describe('tokenizeLine', () => {
  it('colours keys, values and comments without changing the text', () => {
    for (const line of [
      'apiVersion: apps/v1',
      '  - name: "web" # the app',
      '    replicas: 3',
      '# just a comment',
      '---',
      '  - plain item',
      'key: [a, b]',
      '',
    ]) {
      expect(
        tokenizeLine(line)
          .map((t) => t.text)
          .join(''),
      ).toBe(line);
    }
    expect(tokenizeLine('replicas: 3').map((t) => t.cls)).toContain('num');
    expect(tokenizeLine('  - name: "web" # c').map((t) => t.cls)).toEqual(
      expect.arrayContaining(['dash', 'key', 'str', 'com']),
    );
  });
});

describe('manifest info', () => {
  it('summarises lines, kind and apiVersion', () => {
    const meta = (t: string) => describeMeta(t, manifestInfo(t));
    expect(meta('')).toBe('');
    expect(meta(quickStarts.service.text)).toBe(
      `Lines: ${quickStarts.service.text.trimEnd().split('\n').length} | Kind: Service | apiVersion: v1`,
    );
    expect(meta(`${quickStarts.service.text}---\n${quickStarts.secret.text}`)).toContain(
      'Kinds: Service, Secret',
    );
  });

  it('every quick start parses as the kind it is named after', () => {
    for (const q of Object.values(quickStarts)) {
      expect(manifestInfo(q.text).kinds[0]?.kind).toBe(q.label);
    }
  });
});

describe('enhanceTextarea', () => {
  it('numbers the lines, marks the caret line and keeps the textarea value', () => {
    document.body.innerHTML = '<div><textarea id="t"></textarea></div>';
    const box = document.getElementById('t') as HTMLTextAreaElement;
    const editor = enhanceTextarea(box);
    box.value = 'a: 1\nb: 2\nc: 3';
    editor.refresh();
    expect(document.querySelectorAll('.gn')).toHaveLength(3);
    editor.select(2, false);
    expect(document.querySelector('.gn.cur')?.textContent).toBe('2');
    expect(box.value.slice(box.selectionStart, box.selectionEnd)).toBe('b: 2');
    box.setSelectionRange(10, 10);
    expect(caretLine(box)).toBe(3);
  });
});

describe('explain line card', () => {
  const src = quickStarts.deployment.text;
  it('describes the chosen line and steps to the previous and next explained line', () => {
    const view = createView();
    const root = renderExplain(explainManifest(src), src, view);
    view.onLine?.(4);
    expect(root.querySelector('.line-card')?.textContent).toContain('Line 4');
    const nav = () => [...root.querySelectorAll<HTMLButtonElement>('.line-nav button')];
    nav()[1]?.click();
    expect(root.querySelector('.line-title')?.textContent).toContain('Line 5');
    nav()[0]?.click();
    expect(root.querySelector('.line-title')?.textContent).toContain('Line 4');
  });

  it('says so when a line has no explanation instead of inventing one', () => {
    const text = '# note\napiVersion: v1\nkind: Service\n';
    const view = createView();
    const root = renderExplain(explainManifest(text), text, view);
    view.onLine?.(1);
    expect(root.querySelector('.line-why')?.textContent).toContain('No explanation for this line');
  });
});

describe('results', () => {
  it('labels where a finding came from', () => {
    const view = createView();
    view.origin = () => 'Built-in rule';
    const text = 'kind: Pod\nspec:\n  containers:\n    - name: a\n      image: nginx\n';
    const root = renderCheck(checkManifest(text, loadBundledRules()), view);
    expect(root.querySelector('.origin')?.textContent).toBe('Built-in rule');
  });

  it('says two manifests are identical, ignoring comments and quoting', () => {
    const a = 'kind: ConfigMap\nmetadata:\n  name: a\ndata:\n  k: v\n';
    const b = '# hi\nkind: ConfigMap\nmetadata:\n  name: a\ndata:\n  k: "v"\n';
    const root = renderDiff(diffManifests(a, b, loadBundledRules()));
    expect(root.textContent).toContain('No differences');
    const changed = renderDiff(diffManifests(a, a.replace(': v', ': w'), loadBundledRules()));
    expect(changed.textContent).not.toContain('No differences');
  });

  it('shows a YAML syntax problem as such', () => {
    const root = renderCheck(checkManifest('kind: Pod\nspec: [oops\n', loadBundledRules()));
    expect(root.querySelector('.issue-kind')?.textContent).toBe('YAML problem');
  });
});

describe('example rules', () => {
  it('are valid rules in the documented format', () => {
    expect(parseRules(exampleRules, 'example').map((r) => r.id)).toEqual([
      'team-label-required',
      'no-latest-tag',
    ]);
  });
});

describe('explain panel sections', () => {
  const deployment = quickStarts.deployment.text;

  it('lists containers from the places workloads keep them', () => {
    expect(containersOf(explainManifest(deployment).documents[0]?.data)).toEqual([
      'web → nginx:1.27',
    ]);
    expect(containersOf(undefined)).toEqual([]);
  });

  it('overview shows facts read from the manifest, and says when a field is not set', () => {
    const rules = loadBundledRules();
    const root = renderOverview(
      explainManifest(deployment, rules),
      checkManifest(deployment, rules),
    );
    const text = root.textContent ?? '';
    expect(text).toContain('Deployment');
    expect(text).toContain('apps/v1');
    expect(text).toContain('Namespace');
    expect(text).toContain('not set');
    expect(text).toContain('web → nginx:1.27');
  });

  it('suggestions are read-only and point to the Fix tab', () => {
    const rules = loadBundledRules();
    let opened = 0;
    const fix = fixManifest(deployment, rules, { maxRisk: 'high' });
    const root = renderSuggestions(fix, createView(), () => opened++);
    expect(root.textContent).toContain('Nothing is changed from here');
    root.querySelector<HTMLButtonElement>('button.primary')?.click();
    expect(opened).toBe(1);
  });

  it('does not claim there is nothing to improve for an unchecked kind', () => {
    const cr = 'apiVersion: example.com/v1\nkind: Widget\nmetadata:\n  name: w\n';
    const root = renderSuggestions(fixManifest(cr, loadBundledRules()), createView(), () => {});
    expect(root.textContent).toContain('not checked');
  });
});

describe('check grouped by severity', () => {
  const risky =
    'kind: Pod\nspec:\n  containers:\n    - name: a\n      image: nginx\n      securityContext:\n        privileged: true\n';

  it('lists errors, warnings and info under their own headings with the resource named', () => {
    const view = createView();
    view.group = 'severity';
    const root = renderCheck(checkManifest(risky, loadBundledRules()), view);
    const heads = [...root.querySelectorAll('.doc > h2')].map((h) => h.textContent ?? '');
    expect(heads[0]).toMatch(/^Errors/);
    expect(root.querySelector('.findings .res')?.textContent).toContain('Pod');
  });

  it('offers the switch back to resources and asks for a re-render', () => {
    const view = createView();
    view.group = 'severity';
    let redraws = 0;
    view.regroup = () => redraws++;
    const root = renderCheck(checkManifest(risky, loadBundledRules()), view);
    const button = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === 'Group by resource',
    );
    button?.click();
    expect(view.group).toBe('resource');
    expect(redraws).toBe(1);
  });
});
