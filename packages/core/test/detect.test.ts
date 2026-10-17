import { describe, expect, it } from 'vitest';
import { looksLikeKubernetes } from '../src/index.js';

describe('looksLikeKubernetes', () => {
  it('needs apiVersion and kind at the top level', () => {
    expect(looksLikeKubernetes('apiVersion: v1\nkind: Pod\n')).toBe(true);
    expect(looksLikeKubernetes('---\nkind: Pod\n---\napiVersion: v1\nkind: Service\n')).toBe(true);
    expect(looksLikeKubernetes('kind: Pod\n')).toBe(false);
    expect(looksLikeKubernetes('name: ci\non: push\njobs: {}\n')).toBe(false);
    expect(looksLikeKubernetes('services:\n  web:\n    image: nginx\n')).toBe(false);
    expect(looksLikeKubernetes('spec:\n  apiVersion: v1\n  kind: Pod\n')).toBe(false);
  });

  it('leaves Helm templates alone', () => {
    expect(looksLikeKubernetes('apiVersion: v1\nkind: Service\nname: {{ .Values.name }}\n')).toBe(
      false,
    );
  });
});
