// @vitest-environment jsdom
import {
  checkManifest,
  diffManifests,
  explainManifest,
  loadBundledRules,
} from '@k8s-manifestlens/core';
import { describe, expect, it } from 'vitest';
import {
  caretLine,
  describeInfo,
  enhanceTextarea,
  manifestInfo,
  tokenizeLine,
} from '../src/editor.js';
import { exampleRules, quickStarts } from '../src/examples.js';
import { parseRules } from '@k8s-manifestlens/core';
import { createView, renderCheck, renderDiff, renderExplain } from '../src/render.js';

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
  it('names the kind, version and document count', () => {
    expect(describeInfo(manifestInfo(''))).toBe('');
    expect(describeInfo(manifestInfo(quickStarts.service.text))).toBe('Service v1 · 1 document');
    expect(
      describeInfo(manifestInfo(`${quickStarts.service.text}---\n${quickStarts.secret.text}`)),
    ).toBe('Service, Secret · 2 documents');
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
    expect(root.querySelector('.line-card-head strong')?.textContent).toBe('Line 5');
    nav()[0]?.click();
    expect(root.querySelector('.line-card-head strong')?.textContent).toBe('Line 4');
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
