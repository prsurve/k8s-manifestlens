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
  state.collections.get('manifestlens')?.get(`file:///${name}`);

beforeEach(() => reset());
afterEach(() => vi.useRealTimers());

describe('activate', () => {
  it('registers diagnostics, a hover provider and the explain command', () => {
    activate(context() as never);
    expect(state.collections.has('manifestlens')).toBe(true);
    expect(state.hoverProviders).toHaveLength(1);
    expect(state.commands.has('manifestlens.explainFile')).toBe(true);
  });

  it('checks documents that are already open', () => {
    state.textDocuments = [fakeDocument('a.yaml', 'yaml', risky)];
    activate(context() as never);
    expect(diagnosticsFor('a.yaml')).toHaveLength(16);
  });

  it('checks documents as they open, with severity, source, code and range', () => {
    activate(context() as never);
    state.open.forEach((l) => l(fakeDocument('b.yaml', 'yaml', risky)));
    const list = diagnosticsFor('b.yaml') ?? [];
    expect(list).toHaveLength(16);
    const privileged = list.find((d) => d.code === 'privileged-container');
    expect(privileged).toMatchObject({ severity: 0, source: 'ManifestLens' });
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
    expect(diagnosticsFor('d.yaml')).toHaveLength(16); // not yet
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
    expect(diagnosticsFor('g.yaml')).toHaveLength(16);
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
    await state.commands.get('manifestlens.explainFile')?.();
    expect(state.openedDocuments).toHaveLength(1);
    expect(state.openedDocuments[0]?.language).toBe('markdown');
    expect(state.openedDocuments[0]?.content).toContain('## Deployment "web"');
  });

  it('tells the user when there is no Kubernetes file open', async () => {
    activate(context() as never);
    await state.commands.get('manifestlens.explainFile')?.();
    expect(state.infos[0]).toContain('open a Kubernetes YAML file');
    expect(state.openedDocuments).toHaveLength(0);
  });
});
