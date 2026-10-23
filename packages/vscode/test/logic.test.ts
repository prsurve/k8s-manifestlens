import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { explainManifest, loadBundledRules } from '@manifestlens/core';
import {
  explainAsMarkdown,
  findProblems,
  fixTitle,
  hoverMarkdown,
  looksLikeKubernetes,
  planFix,
} from '../src/logic.js';

const example = (name: string) =>
  readFileSync(new URL(`../../../examples/${name}`, import.meta.url), 'utf8');
const rules = loadBundledRules();

describe('looksLikeKubernetes', () => {
  it('needs apiVersion and kind at the top level', () => {
    expect(looksLikeKubernetes(example('web.yaml'))).toBe(true);
    expect(looksLikeKubernetes('kind: Pod\n')).toBe(false);
    expect(looksLikeKubernetes('name: ci\non: push\njobs: {}\n')).toBe(false);
    expect(looksLikeKubernetes('services:\n  web:\n    image: nginx\n')).toBe(false);
  });

  it('leaves Helm templates alone', () => {
    expect(looksLikeKubernetes('apiVersion: v1\nkind: Service\nname: {{ .Values.name }}\n')).toBe(
      false,
    );
  });
});

describe('findProblems', () => {
  it('turns findings into problems on the right line with why and fix', () => {
    const problems = findProblems(example('risky.yaml'), rules);
    expect(problems).toHaveLength(18);
    const privileged = problems.find((p) => p.ruleId === 'privileged-container');
    expect(privileged).toMatchObject({ line: 16, severity: 'error', startColumn: 12 });
    expect(privileged?.message).toContain('Why:');
    expect(privileged?.message).toContain('Fix:');
  });

  it('covers the text of the line, not the indentation', () => {
    const [p] = findProblems(example('risky.yaml'), rules).filter(
      (x) => x.ruleId === 'hostpath-volume',
    );
    const line = example('risky.yaml').split('\n')[p?.line ?? 0] ?? '';
    expect(line.slice(p?.startColumn, p?.endColumn)).toBe('hostPath:');
  });

  it('reports nothing for a hardened manifest', () => {
    expect(findProblems(example('hardened.yaml'), rules)).toEqual([]);
  });

  it('filters by minimum severity', () => {
    const all = findProblems(example('risky.yaml'), rules, 'info');
    const warnings = findProblems(example('risky.yaml'), rules, 'warning');
    const errors = findProblems(example('risky.yaml'), rules, 'error');
    expect(errors.map((p) => p.severity)).toEqual(['error', 'error']);
    expect(warnings.length).toBe(11);
    expect(all.length).toBe(18);
  });

  it('reports YAML syntax errors as errors, but only in Kubernetes files', () => {
    const broken = 'apiVersion: v1\nkind: Pod\nspec: [oops\n';
    const [p] = findProblems(broken, rules);
    expect(p).toMatchObject({ severity: 'error', ruleId: 'yaml-syntax' });
    expect(findProblems('name: ci\non: [oops\n', rules)).toEqual([]);
  });

  it('ignores files that are not Kubernetes manifests', () => {
    expect(findProblems('services:\n  web:\n    image: nginx\n', rules)).toEqual([]);
  });
});

describe('hoverMarkdown', () => {
  const result = explainManifest(example('web.yaml'));

  it('explains the field on a line and links the docs', () => {
    const md = hoverMarkdown(result, 19);
    expect(md).toContain('spec.template.spec.containers[0].image');
    expect(md).toContain('The container image to run');
    expect(md).toContain('[Kubernetes docs](https://kubernetes.io/docs/');
  });

  it('returns nothing where there is no explanation', () => {
    expect(hoverMarkdown(result, 400)).toBeUndefined();
    const unknown = explainManifest('apiVersion: v1\nkind: Pod\nspec:\n  madeUp: 1\n');
    expect(hoverMarkdown(unknown, 4)).toBeUndefined();
  });

  it('does not let a key break out of the code span', () => {
    const md = hoverMarkdown(
      explainManifest(
        'apiVersion: v1\nkind: Service\nmetadata:\n  labels:\n    "a`](http://evil)`b": x\n',
      ),
      5,
    );
    expect(md).toBeDefined();
    expect(md?.split('\n\n')[0]).toMatch(/^\*\*`[^`]*`\*\*$/);
  });
});

describe('explainAsMarkdown', () => {
  it('lists explained lines per object with each link once', () => {
    const md = explainAsMarkdown(example('web.yaml'));
    expect(md).toContain('## Deployment "web"');
    expect(md).toContain('## Service "web"');
    expect(md).toContain('**Line 19** `image: nginx:1.27`');
    const links = md.match(/\(\[docs\]\([^)]*\)\)/g) ?? [];
    expect(links.length).toBeGreaterThan(3);
  });

  it('copes with empty and unsupported files', () => {
    expect(explainAsMarkdown('')).toContain('No Kubernetes documents found');
    expect(explainAsMarkdown('apiVersion: v1\nkind: Certificate\ndata: {}\n')).toContain(
      'No field explanations',
    );
  });
});

describe('planFix', () => {
  const pod =
    'apiVersion: v1\nkind: Pod\nmetadata:\n  name: p\nspec:\n  containers:\n    - name: a\n      image: x:1\n';

  it('expresses a fix as line edits that rebuild the fixed text', () => {
    const { result, edits } = planFix(pod, rules, { only: ['allow-privilege-escalation'] });
    expect(result.status).toBe('fixed');
    const lines = pod.match(/[^\n]*\n|[^\n]+$/g) ?? [];
    let out = '';
    let at = 0;
    for (const e of edits) {
      out += lines.slice(at, e.startLine).join('') + e.text;
      at = e.startLine + e.deleteCount;
    }
    expect(out + lines.slice(at).join('')).toBe(result.fixed);
  });

  it('has no edits when nothing is fixed, and no title', () => {
    const plan = planFix(example('hardened.yaml'), rules, {});
    expect(plan.edits).toEqual([]);
    expect(fixTitle(plan.result)).toBeUndefined();
  });
});
