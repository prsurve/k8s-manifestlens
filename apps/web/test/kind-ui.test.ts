// @vitest-environment jsdom
import { KindStore, MemoryKindStorage, explainManifest } from '@k8s-manifestlens/core';
import { describe, expect, it, vi } from 'vitest';
import { openManager, openOnboarding, renderPreview } from '../src/kind-dialog.js';
import { ONBOARD_EVENT, kindNotice } from '../src/kind-notice.js';
import { renderExplain } from '../src/render.js';

const CRD = `apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
spec:
  group: w.io
  scope: Cluster
  names: { kind: Widget }
  versions:
    - name: v1
      schema:
        openAPIV3Schema:
          type: object
          properties:
            spec:
              type: object
              required: [size]
              properties:
                size: { type: integer, maximum: 5 }
                tags: { type: array, minItems: 1, items: { type: string } }
`;

const box = (): HTMLTextAreaElement => {
  const t = document.querySelector<HTMLTextAreaElement>('.kind-text');
  if (!t) throw new Error('no schema box');
  return t;
};
const tick = () => new Promise((r) => setTimeout(r, 0));
const click = (label: string): void => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent === label);
  if (!b) throw new Error(`no button "${label}"`);
  b.click();
};

describe('kind notice', () => {
  it('tells a missing built-in, a custom resource, a typo and a malformed identity apart', () => {
    const t = (k: string, v?: string) => kindNotice(k, v);
    expect(t('Lease', 'coordination.k8s.io/v1').textContent).toMatch(/built-in Kubernetes kind/);
    expect(t('Lease', 'coordination.k8s.io/v1').querySelector('button')?.textContent).toBe(
      'Add support',
    );
    expect(t('Certificate', 'cert-manager.io/v1').textContent).toMatch(/custom resource/);
    expect(t('Podd', 'v1').textContent).toMatch(/spelling/);
    const bad = t('Certificate');
    expect(bad.textContent).toMatch(/no "apiVersion"/);
    expect(bad.querySelector('button')).toBeNull();
  });

  it('asks the page to open the wizard, and shows up in the Explain view', () => {
    const src = 'apiVersion: w.io/v1\nkind: Widget\n';
    const root = renderExplain(explainManifest(src), src);
    const seen = vi.fn();
    document.body.append(root);
    document.addEventListener(ONBOARD_EVENT, (e) => seen((e as CustomEvent).detail));
    root.querySelector<HTMLButtonElement>('.kind-notice button')?.click();
    expect(seen).toHaveBeenCalledWith({ kind: 'Widget', apiVersion: 'w.io/v1' });
  });
});

describe('onboarding wizard', () => {
  it('previews, registers and triggers re-analysis, listing what is not checked', async () => {
    const store = new KindStore(new MemoryKindStorage());
    const onChange = vi.fn(() => Promise.resolve());
    openOnboarding({ store, onChange }, { kind: 'Widget', apiVersion: 'w.io/v1' });
    box().value = CRD;
    click('Preview');
    await tick();
    const dialog = document.getElementById('kind-dialog');
    expect(dialog?.textContent).toMatch(/Scope: Cluster/);
    expect(dialog?.textContent).toMatch(/minItems/);
    expect(dialog?.textContent).toMatch(/does not mean those parts are valid/);
    click('Register');
    await tick();
    await tick();
    expect(onChange).toHaveBeenCalled();
    expect(await store.list()).toHaveLength(1);
    expect(dialog?.textContent).toMatch(/re-analyzed/);
  });

  it('shows the contribution guide for a missing built-in and refuses a bad schema', async () => {
    const store = new KindStore(new MemoryKindStorage());
    openOnboarding(
      { store, onChange: () => Promise.resolve() },
      { kind: 'Lease', apiVersion: 'coordination.k8s.io/v1' },
    );
    expect(document.getElementById('kind-dialog')?.textContent).toMatch(/ROOTS/);
    box().value = '[oops';
    click('Preview');
    await tick();
    expect(document.querySelector('.error')).not.toBeNull();
    expect((await store.list()).length).toBe(0);
  });
});

describe('manager', () => {
  it('lists built-in, missing and imported kinds, and removes an import', async () => {
    const store = new KindStore(new MemoryKindStorage());
    await store.add('crd', CRD);
    const onChange = vi.fn(() => Promise.resolve());
    openManager({ store, onChange });
    await tick();
    const text = document.getElementById('kind-dialog')?.textContent ?? '';
    expect(text).toMatch(/Built-in kinds \(25\)/);
    expect(text).toMatch(/Missing built-in coverage \(\d+\)/);
    expect(text).toMatch(/Imported CRDs \(1\)/);
    expect(text).toMatch(/Ecosystem packs \(0\)/);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    click('Remove');
    await tick();
    await tick();
    expect(await store.list()).toHaveLength(0);
    expect(onChange).toHaveBeenCalled();
  });
});

describe('renderPreview', () => {
  it('never claims unchecked constraints were validated', async () => {
    const { previews } = (await import('@k8s-manifestlens/core')).importCrds(CRD);
    const root = renderPreview(previews);
    expect(root.textContent).toMatch(/Not checked/);
    const checked = [...root.querySelectorAll('p')].find((p) =>
      p.textContent?.startsWith('Checked:'),
    );
    expect(checked?.textContent).toMatch(/maximum/);
    expect(checked?.textContent).not.toMatch(/minItems/);
  });
});
