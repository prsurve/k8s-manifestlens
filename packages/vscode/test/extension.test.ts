import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Position, fakeDocument, reset, state } from './vscode-mock.js';
import { activate } from '../src/extension.js';

const example = (name: string) =>
  readFileSync(new URL(`../../../examples/${name}`, import.meta.url), 'utf8');
const risky = example('risky.yaml');

const memento = () => {
  const data = new Map<string, unknown>();
  return {
    get: <T>(k: string) => data.get(k) as T | undefined,
    update: async (k: string, v: unknown) => void data.set(k, v),
  };
};
const context = (globalState = memento()) => ({
  subscriptions: [] as { dispose(): void }[],
  globalState,
});
const diagnosticsFor = (name: string) =>
  state.collections.get('k8s-manifestlens')?.get(`file:///${name}`);

beforeEach(() => reset());
afterEach(() => vi.useRealTimers());

describe('activate', () => {
  it('registers diagnostics, a hover provider and the explain command', () => {
    activate(context() as never);
    expect(state.collections.has('k8s-manifestlens')).toBe(true);
    expect(state.hoverProviders).toHaveLength(1);
    expect(state.commands.has('k8sManifestlens.explainFile')).toBe(true);
  });

  it('checks documents that are already open', () => {
    state.textDocuments = [fakeDocument('a.yaml', 'yaml', risky)];
    activate(context() as never);
    expect(diagnosticsFor('a.yaml')).toHaveLength(18);
  });

  it('checks documents as they open, with severity, source, code and range', () => {
    activate(context() as never);
    state.open.forEach((l) => l(fakeDocument('b.yaml', 'yaml', risky)));
    const list = diagnosticsFor('b.yaml') ?? [];
    expect(list).toHaveLength(18);
    const privileged = list.find((d) => d.code === 'privileged-container');
    expect(privileged).toMatchObject({ severity: 0, source: 'k8s-manifestlens' });
    expect(privileged?.range.start.line).toBe(16);
    expect(privileged?.message).toContain('Fix:');
  });

  it('skips other languages and non-Kubernetes YAML', () => {
    activate(context() as never);
    state.open.forEach((l) => l(fakeDocument('c.json', 'json', risky)));
    state.open.forEach((l) => l(fakeDocument('ci.yaml', 'yaml', 'name: ci\non: push\n')));
    expect(diagnosticsFor('c.json')).toBeUndefined();
    expect(diagnosticsFor('ci.yaml')).toEqual([]);
  });

  it('re-checks after edits, debounced, and clears on close', () => {
    vi.useFakeTimers();
    activate(context() as never);
    const doc = fakeDocument('d.yaml', 'yaml', risky);
    state.open.forEach((l) => l(doc));
    const fixed = fakeDocument('d.yaml', 'yaml', example('hardened.yaml'), 2);
    state.change.forEach((l) => l({ document: fixed }));
    expect(diagnosticsFor('d.yaml')).toHaveLength(18); // not yet
    vi.advanceTimersByTime(400);
    expect(diagnosticsFor('d.yaml')).toEqual([]);
    state.close.forEach((l) => l(fixed));
    expect(diagnosticsFor('d.yaml')).toBeUndefined();
  });

  it('honours the enable and minimumSeverity settings', () => {
    activate(context() as never);
    state.settings['minimumSeverity'] = 'error';
    state.config.forEach((l) => l({ affectsConfiguration: () => true }));
    state.open.forEach((l) => l(fakeDocument('e.yaml', 'yaml', risky)));
    expect(diagnosticsFor('e.yaml')).toHaveLength(2);

    state.settings['enable'] = false;
    state.open.forEach((l) => l(fakeDocument('e.yaml', 'yaml', risky)));
    expect(diagnosticsFor('e.yaml')).toBeUndefined();
  });

  it('loads extra rules from configured files and folders', () => {
    const custom = fileURLToPath(new URL('../../cli/test/fixtures/custom-rules', import.meta.url));
    state.settings['rules'] = [custom];
    activate(context() as never);
    state.open.forEach((l) => l(fakeDocument('f.yaml', 'yaml', example('hardened.yaml'))));
    const codes = (diagnosticsFor('f.yaml') ?? []).map((d) => d.code);
    expect(codes).toContain('team-needs-owner-label');
  });

  it('warns once about unreadable rule paths and keeps the built-in rules', () => {
    state.settings['rules'] = ['/does/not/exist', '/also/missing'];
    activate(context() as never);
    expect(state.warnings).toHaveLength(1);
    state.open.forEach((l) => l(fakeDocument('g.yaml', 'yaml', risky)));
    expect(diagnosticsFor('g.yaml')).toHaveLength(18);
  });
});

describe('hover', () => {
  it('explains the field under the cursor', () => {
    activate(context() as never);
    const doc = fakeDocument('h.yaml', 'yaml', example('web.yaml'));
    const hover = state.hoverProviders[0]?.provideHover(doc, new Position(18, 4));
    expect(hover?.contents.value).toContain('The container image to run');
  });

  it('returns nothing outside Kubernetes files or when disabled', () => {
    activate(context() as never);
    const provider = state.hoverProviders[0];
    expect(
      provider?.provideHover(fakeDocument('x.yaml', 'yaml', 'name: ci\n'), new Position(0, 0)),
    ).toBeUndefined();
    state.settings['enable'] = false;
    expect(
      provider?.provideHover(
        fakeDocument('y.yaml', 'yaml', example('web.yaml')),
        new Position(18, 4),
      ),
    ).toBeUndefined();
  });
});

describe('explain command', () => {
  it('opens a markdown explanation beside the editor', async () => {
    activate(context() as never);
    state.activeDocument = fakeDocument('z.yaml', 'yaml', example('web.yaml'));
    await state.commands.get('k8sManifestlens.explainFile')?.();
    expect(state.openedDocuments).toHaveLength(1);
    expect(state.openedDocuments[0]?.language).toBe('markdown');
    expect(state.openedDocuments[0]?.content).toContain('## Deployment "web"');
  });

  it('tells the user when there is no Kubernetes file open', async () => {
    activate(context() as never);
    await state.commands.get('k8sManifestlens.explainFile')?.();
    expect(state.infos[0]).toContain('open a Kubernetes YAML file');
    expect(state.openedDocuments).toHaveLength(0);
  });
});

describe('fixes', () => {
  const pod = `apiVersion: v1
kind: Pod
metadata:
  name: web
spec:
  containers:
    - name: app
      image: nginx:1.27
      securityContext:
        runAsUser: 1000
`;

  /** The diagnostics k8s-manifestlens published for a document, as the editor passes them to code actions. */
  function actionsFor(doc: ReturnType<typeof fakeDocument>, code: string) {
    const diagnostics = (diagnosticsFor(doc.uri.fsPath.slice(1)) ?? []).filter(
      (d) => d.code === code,
    );
    const first = diagnostics[0];
    if (!first) return [];
    return (
      state.codeActionProviders[0]?.provideCodeActions(doc, first.range, { diagnostics }) ?? []
    );
  }

  it('offers a quick fix on a fixable finding, with the edit but no application', () => {
    activate(context() as never);
    const doc = fakeDocument('q.yaml', 'yaml', pod);
    state.open.forEach((l) => l(doc));
    const [action] = actionsFor(doc, 'allow-privilege-escalation');
    expect(action?.title).toBe(
      'k8s-manifestlens: Set securityContext.allowPrivilegeEscalation to false.',
    );
    expect(action?.edit?.replacements).toHaveLength(1);
    expect(action?.edit?.replacements[0]?.text).toContain('allowPrivilegeEscalation: false');
    expect(state.applied).toHaveLength(0);
  });

  it('labels higher-risk quick fixes and offers none for findings that need input or have no fix', () => {
    activate(context() as never);
    const doc = fakeDocument('r.yaml', 'yaml', pod.replace('runAsUser: 1000', 'privileged: true'));
    state.open.forEach((l) => l(doc));
    expect(actionsFor(doc, 'privileged-container')[0]?.title).toContain('[high risk: review]');
    expect(actionsFor(doc, 'missing-memory-limit')).toEqual([]);
    expect(actionsFor(doc, 'missing-readiness-probe')).toEqual([]);
  });

  it('fixes only the finding the quick fix was asked for', () => {
    activate(context() as never);
    const two = `${pod}    - name: other\n      image: busybox:1.36\n      securityContext:\n        runAsUser: 1000\n`;
    const doc = fakeDocument('s.yaml', 'yaml', two);
    state.open.forEach((l) => l(doc));
    const list = (diagnosticsFor('s.yaml') ?? []).filter(
      (d) => d.code === 'allow-privilege-escalation',
    );
    expect(list).toHaveLength(2);
    const second = list[1];
    if (!second) throw new Error('expected two diagnostics');
    const [action] =
      state.codeActionProviders[0]?.provideCodeActions(doc, second.range, {
        diagnostics: [second],
      }) ?? [];
    expect(action?.edit?.replacements).toHaveLength(1);
    expect(action?.edit?.replacements[0]?.range.start.line).toBeGreaterThan(9);
  });

  it('the fix command shows a preview and applies only after the user confirms', async () => {
    activate(context() as never);
    state.activeDocument = fakeDocument('t.yaml', 'yaml', pod);
    state.choice = undefined;
    await state.commands.get('k8sManifestlens.fixFile')?.();
    expect(state.openedDocuments[0]?.content).toContain('allowPrivilegeEscalation: false');
    expect(state.executed[0]?.[0]).toBe('vscode.diff');
    expect(state.applied).toHaveLength(0);

    state.choice = 'Apply';
    await state.commands.get('k8sManifestlens.fixFile')?.();
    expect(state.applied).toHaveLength(1);
  });

  it('refuses to apply when the file changed after the preview', async () => {
    activate(context() as never);
    const doc = fakeDocument('u.yaml', 'yaml', pod);
    state.activeDocument = doc;
    state.choice = 'Apply';
    const original = doc.getText;
    let calls = 0;
    // The first read is for the plan; by the time of the confirmation the buffer has changed.
    doc.getText = () => (++calls <= 2 ? original() : `${original()}# edited\n`);
    await state.commands.get('k8sManifestlens.fixFile')?.();
    expect(state.applied).toHaveLength(0);
    expect(state.warnings.at(-1)).toContain('changed since the preview');
  });

  it('only applies fixes up to the configured risk, and says what was held back', async () => {
    activate(context() as never);
    state.activeDocument = fakeDocument('v.yaml', 'yaml', example('hardened.yaml'));
    await state.commands.get('k8sManifestlens.fixFile')?.();
    expect(state.infos.at(-1)).toContain('no fixes to apply');
    state.activeDocument = fakeDocument(
      'w.yaml',
      'yaml',
      pod.replace('runAsUser: 1000', 'privileged: true'),
    );
    state.settings['fixMaxRisk'] = 'low';
    state.choice = 'Apply';
    await state.commands.get('k8sManifestlens.fixFile')?.();
    expect(state.openedDocuments).toHaveLength(0);
    expect(state.applied).toHaveLength(0);
    expect(state.infos.at(-1)).toContain('need review or input');
  });
});

describe('kinds', () => {
  const CRD = `apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
spec:
  group: w.io
  names: { kind: Widget }
  versions:
    - name: v1
      schema:
        openAPIV3Schema:
          type: object
          properties:
            spec:
              type: object
              properties:
                size: { type: integer, maximum: 5 }
                tags: { type: array, minItems: 1, items: { type: string } }
`;
  const widget = 'apiVersion: w.io/v1\nkind: Widget\nspec:\n  size: 9\n';
  const messages = (name: string) => (diagnosticsFor(name) ?? []).map((d) => d.message).join('\n');
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it('offers "Add support" on an unsupported kind, and not on a malformed one', () => {
    activate(context() as never);
    const doc = fakeDocument('w.yaml', 'yaml', widget);
    state.textDocuments = [doc];
    state.open.forEach((l) => l(doc));
    const diagnostics = (diagnosticsFor('w.yaml') ?? []).filter(
      (d) => d.code === 'unsupported-kind',
    );
    expect(diagnostics).toHaveLength(1);
    const first = diagnostics[0];
    if (!first) throw new Error('no diagnostic');
    const actions =
      state.codeActionProviders[0]?.provideCodeActions(doc, first.range, { diagnostics }) ?? [];
    expect(actions[0]?.title).toContain('Add support for Widget');
    expect(actions[0]?.command?.command).toBe('k8sManifestlens.addKind');
    expect(actions[0]?.command?.arguments?.[0]).toEqual({ kind: 'Widget', apiVersion: 'w.io/v1' });
  });

  it('previews, registers on confirmation, re-checks open files and survives a restart', async () => {
    const shared = memento();
    const doc = fakeDocument('w.yaml', 'yaml', widget);
    state.textDocuments = [doc];
    activate(context(shared) as never);
    expect(messages('w.yaml')).not.toContain('above the maximum');

    state.picks = ['Paste from the clipboard'];
    state.clipboard = CRD;
    state.choice = undefined;
    await state.commands.get('k8sManifestlens.addKind')?.({
      kind: 'Widget',
      apiVersion: 'w.io/v1',
    });
    expect(state.openedDocuments.at(-1)?.content).toContain('NOT checked');
    expect(messages('w.yaml')).not.toContain('above the maximum'); // declined: nothing registered

    state.picks = ['Paste from the clipboard'];
    state.choice = 'Register';
    await state.commands.get('k8sManifestlens.addKind')?.({
      kind: 'Widget',
      apiVersion: 'w.io/v1',
    });
    expect(messages('w.yaml')).toContain('above the maximum of 5');
    expect(doc.getText()).toBe(widget); // the user's text is never touched

    reset();
    state.textDocuments = [doc];
    activate(context(shared) as never);
    await tick();
    expect(messages('w.yaml')).toContain('above the maximum of 5');
  });

  it('asks which kind an OpenAPI schema describes when it does not say', async () => {
    const lease = fakeDocument(
      'l.yaml',
      'yaml',
      'apiVersion: coordination.k8s.io/v1\nkind: Lease\nspec:\n  holderIdentity: 5\n',
    );
    state.textDocuments = [lease];
    const shared = memento();
    activate(context(shared) as never);
    state.picks = ['Paste from the clipboard'];
    state.clipboard =
      'type: object\nproperties:\n  spec:\n    type: object\n    properties:\n      holderIdentity: { type: string }\n';
    state.input = 'coordination.k8s.io/v1 Lease';
    state.choice = 'Register';
    await state.commands.get('k8sManifestlens.addKind')?.();
    expect(messages('l.yaml')).toMatch(/holderIdentity/);
    expect(state.infos.at(-1)).toContain('coordination.k8s.io/v1/Lease');
  });

  it('refuses a schema that claims a built-in kind', async () => {
    activate(context() as never);
    state.picks = ['Paste from the clipboard'];
    state.clipboard = CRD.replace('w.io', 'networking.k8s.io').replace('Widget', 'Ingress');
    state.choice = 'Register';
    await state.commands.get('k8sManifestlens.addKind')?.();
    expect(state.warnings.at(-1)).toContain('built-in');
  });

  it('manages saved kinds: disable, enable and remove', async () => {
    const doc = fakeDocument('w.yaml', 'yaml', widget);
    state.textDocuments = [doc];
    const shared = memento();
    activate(context(shared) as never);
    state.picks = ['Paste from the clipboard'];
    state.clipboard = CRD;
    state.choice = 'Register';
    await state.commands.get('k8sManifestlens.addKind')?.();
    expect(messages('w.yaml')).toContain('above the maximum');

    state.picks = ['Widget', 'Disable'];
    await state.commands.get('k8sManifestlens.manageKinds')?.();
    expect(messages('w.yaml')).not.toContain('above the maximum');
    state.picks = ['Widget', 'Enable'];
    await state.commands.get('k8sManifestlens.manageKinds')?.();
    expect(messages('w.yaml')).toContain('above the maximum');
    state.picks = ['Widget', 'Remove'];
    state.choice = 'Remove';
    await state.commands.get('k8sManifestlens.manageKinds')?.();
    expect(messages('w.yaml')).not.toContain('above the maximum');
    await state.commands.get('k8sManifestlens.manageKinds')?.();
    expect(state.infos.at(-1)).toContain('no imported kinds');
  });

  it('loads registry files from the kinds setting, and warns once about a bad one', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { KindStore, MemoryKindStorage } = await import('@k8s-manifestlens/core');
    const store = new KindStore(new MemoryKindStorage());
    await store.add('crd', CRD);
    const dir = mkdtempSync(join(tmpdir(), 'ml-vscode-'));
    const file = join(dir, 'kinds.json');
    writeFileSync(file, await store.export());
    const doc = fakeDocument('w.yaml', 'yaml', widget);
    state.textDocuments = [doc];
    state.settings = { kinds: [file] };
    activate(context() as never);
    expect(messages('w.yaml')).toContain('above the maximum of 5');

    reset();
    writeFileSync(file, '{nope');
    state.settings = { kinds: [file] };
    state.textDocuments = [doc];
    activate(context() as never);
    expect(state.warnings).toHaveLength(1);
    expect(state.warnings[0]).toContain('Cannot read the kind registry');
  });
});
