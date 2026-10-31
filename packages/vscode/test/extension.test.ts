import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Position, fakeDocument, reset, state } from './vscode-mock.js';
import { activate } from '../src/extension.js';

const example = (name: string) =>
  readFileSync(new URL(`../../../examples/${name}`, import.meta.url), 'utf8');
const risky = example('risky.yaml');

const context = () => ({ subscriptions: [] as { dispose(): void }[] });
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
