import { readFileSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import * as vscode from 'vscode';
import {
  RuleError,
  classifyKind,
  explainManifest,
  formatPreview,
  isStale,
  loadBundledRules,
  parseFixPolicy,
  parseManifest,
  parseRules,
} from '@k8s-manifestlens/core';
import type {
  ExplainResult,
  FixPolicy,
  FixRisk,
  Rule,
  SchemaIdentity,
  Severity,
  StoredKindSet,
} from '@k8s-manifestlens/core';
import {
  compileSchema,
  createStore,
  detectFormat,
  kindRules,
  looksLikeSchema,
  parseIdentity,
  readConfiguredKinds,
} from './kinds.js';
import type { Memento } from './kinds.js';
import {
  explainAsMarkdown,
  findProblems,
  fixTitle,
  hoverMarkdown,
  looksLikeKubernetes,
  planFix,
} from './logic.js';
import type { PlannedFix } from './logic.js';

const SEVERITY: Record<Severity, vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
};

/** The kind a diagnostic on a manifest's first line is about, for the "add support" quick fix. */
interface KindHint {
  kind: string;
  apiVersion?: string | undefined;
}

export function activate(context: vscode.ExtensionContext): void {
  const diagnostics = vscode.languages.createDiagnosticCollection('k8s-manifestlens');
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const explained = new Map<string, { version: number; result: ExplainResult }>();
  let rules: Rule[] = loadBundledRules();
  let warnedAboutRules = false;
  let policy: FixPolicy | undefined;
  const kindStore = createStore((context as { globalState?: Memento }).globalState);
  let savedKinds: StoredKindSet[] = [];
  let kindProblems = '';

  const config = () => vscode.workspace.getConfiguration('k8sManifestlens');

  function reloadRules(): void {
    rules = loadBundledRules();
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const at = (p: string): string => (isAbsolute(p) || !folder ? p : join(folder, p));
    // Imported kinds (saved ones, and registry files from the `kinds` setting) come first, so a
    // rule a user writes for a custom kind can build on them.
    try {
      const configured = readConfiguredKinds(config().get<string[]>('kinds', []), at);
      const loaded = kindRules(
        configured,
        savedKinds.filter((s) => s.enabled),
      );
      rules.push(...loaded.rules);
      const problems = loaded.problems.join('\n');
      if (problems !== '' && problems !== kindProblems) {
        void vscode.window.showWarningMessage(`k8s-manifestlens: ${problems}`);
      }
      kindProblems = problems;
    } catch (err) {
      if (!warnedAboutRules) {
        warnedAboutRules = true;
        void vscode.window.showWarningMessage(
          `k8s-manifestlens: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    for (const path of config().get<string[]>('rules', [])) {
      try {
        rules.push(...readRules(at(path)));
      } catch (err) {
        if (!warnedAboutRules) {
          warnedAboutRules = true;
          void vscode.window.showWarningMessage(
            `k8s-manifestlens: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
    const seen = new Set<string>();
    rules = rules.filter((r) => !seen.has(r.id) && seen.add(r.id));

    policy = undefined;
    const policyPath = config().get<string>('fixPolicy', '');
    if (policyPath) {
      try {
        const full = isAbsolute(policyPath) || !folder ? policyPath : join(folder, policyPath);
        policy = parseFixPolicy(readFileSync(full, 'utf8'), policyPath);
      } catch (err) {
        void vscode.window.showWarningMessage(
          `k8s-manifestlens: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  function toEdit(doc: vscode.TextDocument, plan: PlannedFix): vscode.WorkspaceEdit {
    const edit = new vscode.WorkspaceEdit();
    for (const e of plan.edits) {
      edit.replace(
        doc.uri,
        new vscode.Range(e.startLine, 0, e.startLine + e.deleteCount, 0),
        e.text,
      );
    }
    return edit;
  }

  /** Quick fixes: one per finding the user points at. Choosing one is the approval for its risk. */
  const quickFixes: vscode.CodeActionProvider = {
    provideCodeActions(doc, _range, context) {
      if (!config().get<boolean>('enable', true)) return [];
      const actions: vscode.CodeAction[] = [];
      for (const diagnostic of context.diagnostics) {
        if (diagnostic.source !== 'k8s-manifestlens' || typeof diagnostic.code !== 'string')
          continue;
        if (diagnostic.code === 'unsupported-kind') {
          const hint = parseManifest(doc.getText()).find(
            (d) => d.startLine === diagnostic.range.start.line + 1,
          );
          if (hint?.kind && classifyKind(hint.kind, hint.apiVersion).category !== 'malformed') {
            const action = new vscode.CodeAction(
              `k8s-manifestlens: Add support for ${hint.kind}…`,
              vscode.CodeActionKind.QuickFix,
            );
            action.diagnostics = [diagnostic];
            action.command = {
              command: 'k8sManifestlens.addKind',
              title: 'Add support for this kind',
              arguments: [{ kind: hint.kind, apiVersion: hint.apiVersion } satisfies KindHint],
            };
            actions.push(action);
          }
          continue;
        }
        const plan = planFix(doc.getText(), rules, {
          findings: [{ ruleId: diagnostic.code, line: diagnostic.range.start.line + 1 }],
          maxRisk: 'high',
          ...(policy ? { policy } : {}),
        });
        const title = fixTitle(plan.result);
        if (!title) continue;
        const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
        action.diagnostics = [diagnostic];
        action.edit = toEdit(doc, plan);
        actions.push(action);
      }
      return actions;
    },
  };

  function refresh(doc: vscode.TextDocument): void {
    if (doc.languageId !== 'yaml' || !config().get<boolean>('enable', true)) {
      diagnostics.delete(doc.uri);
      return;
    }
    const minimum = config().get<Severity>('minimumSeverity', 'info');
    const problems = findProblems(doc.getText(), rules, minimum);
    diagnostics.set(
      doc.uri,
      problems.map((p) => {
        const d = new vscode.Diagnostic(
          new vscode.Range(p.line, p.startColumn, p.line, p.endColumn),
          p.message,
          SEVERITY[p.severity],
        );
        d.source = 'k8s-manifestlens';
        d.code = p.ruleId;
        return d;
      }),
    );
  }

  function refreshSoon(doc: vscode.TextDocument): void {
    const key = doc.uri.toString();
    clearTimeout(timers.get(key));
    timers.set(
      key,
      setTimeout(() => refresh(doc), 300),
    );
  }

  const refreshAll = (): void => vscode.workspace.textDocuments.forEach(refresh);

  /** Re-read the saved kinds, then re-check everything that is open. Nothing in the editors changes. */
  async function reloadKinds(): Promise<void> {
    try {
      savedKinds = await kindStore.list();
    } catch {
      savedKinds = [];
    }
    reloadRules();
    explained.clear();
    refreshAll();
  }

  /** Import a CRD or OpenAPI schema: choose it, preview what it can check, then register it. */
  async function addKind(hint?: KindHint): Promise<void> {
    const active = vscode.window.activeTextEditor?.document;
    const choices: { label: string; id: 'clipboard' | 'file' | 'open' }[] = [
      { label: 'Paste from the clipboard', id: 'clipboard' },
      { label: 'Choose a file…', id: 'file' },
    ];
    if (active && looksLikeSchema(active.getText())) {
      choices.unshift({ label: 'Use the open file', id: 'open' });
    }
    const picked = await vscode.window.showQuickPick(choices, {
      placeHolder: hint
        ? `Where is the schema for ${hint.kind}? (a CRD or an OpenAPI schema)`
        : 'Where is the CRD or OpenAPI schema?',
    });
    if (!picked) return;
    let text: string | undefined;
    if (picked.id === 'open') text = active?.getText();
    else if (picked.id === 'clipboard') text = await vscode.env.clipboard.readText();
    else {
      const files = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { Schemas: ['yaml', 'yml', 'json'] },
      });
      const file = files?.[0];
      if (file) text = readFileSync(file.fsPath, 'utf8');
    }
    if (text === undefined || text.trim() === '') return;

    const format = detectFormat(text);
    let identity: SchemaIdentity | undefined;
    if (hint) {
      const group = hint.apiVersion?.includes('/') ? hint.apiVersion.split('/')[0] : '';
      const version = hint.apiVersion?.split('/').pop();
      if (version) identity = { group: group ?? '', version, kind: hint.kind };
    }
    try {
      let compiled;
      try {
        compiled = compileSchema(format, text, identity);
      } catch (err) {
        // An OpenAPI schema that does not name its own kind needs to be told which kind it is.
        if (format !== 'openapi' || identity || !(err instanceof RuleError)) throw err;
        const answer = await vscode.window.showInputBox({
          prompt: 'Which kind does this schema describe? Group/version and kind',
          placeHolder: 'coordination.k8s.io/v1 Lease   (or: v1 Node)',
        });
        identity = answer ? parseIdentity(answer) : undefined;
        if (!identity) return;
        compiled = compileSchema(format, text, identity);
      }
      const preview = await vscode.workspace.openTextDocument({
        language: 'markdown',
        content: `# Schema preview\n\n\`\`\`\n${formatPreview(compiled.previews)}\n\`\`\`\n`,
      });
      await vscode.window.showTextDocument(preview, {
        viewColumn: vscode.ViewColumn.Beside,
        preview: true,
      });
      const names = compiled.previews.map((p) => p.kind).join(', ');
      const choice = await vscode.window.showInformationMessage(
        `k8s-manifestlens: register ${names}? Constraints listed as NOT checked are never reported as valid.`,
        'Register',
      );
      if (choice !== 'Register') return;
      const out = await kindStore.add(format, text, {
        origin: 'your schema',
        ...(identity ? { identity } : {}),
      });
      await reloadKinds();
      const done = [...out.registration.added, ...out.registration.updated];
      if (done.length > 0) {
        void vscode.window.showInformationMessage(
          `k8s-manifestlens: registered ${done.join(', ')}. Open manifests were re-checked.`,
        );
      }
      for (const r of out.registration.rejected) {
        void vscode.window.showWarningMessage(
          `k8s-manifestlens: ${r.kind} ${r.version} was not registered: ${r.reason}`,
        );
      }
    } catch (err) {
      void vscode.window.showWarningMessage(
        `k8s-manifestlens: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** List the saved kinds, with view, enable or disable, remove and export. */
  async function manageKinds(): Promise<void> {
    const sets = await kindStore.list();
    if (sets.length === 0) {
      void vscode.window.showInformationMessage(
        'k8s-manifestlens: no imported kinds yet. Use "Add a custom resource or kind schema".',
      );
      return;
    }
    const set = await vscode.window.showQuickPick(
      sets.map((s) => ({
        label: s.kinds.map((k) => k.kind).join(', '),
        description: `${s.format === 'crd' ? 'CRD' : 'OpenAPI'}${s.enabled ? '' : ' (disabled)'}`,
        set: s,
      })),
      { placeHolder: 'Imported kinds' },
    );
    if (!set) return;
    const action = await vscode.window.showQuickPick(
      ['View what it checks', set.set.enabled ? 'Disable' : 'Enable', 'Remove', 'Export as JSON'],
      { placeHolder: set.label },
    );
    if (action === 'Remove') {
      const sure = await vscode.window.showInformationMessage(
        `k8s-manifestlens: remove ${set.label}? Manifests of this kind will no longer be explained.`,
        'Remove',
      );
      if (sure === 'Remove') {
        await kindStore.remove(set.set.id);
        await reloadKinds();
      }
    } else if (action === 'Disable' || action === 'Enable') {
      await kindStore.setEnabled(set.set.id, action === 'Enable');
      await reloadKinds();
    } else if (action === 'Export as JSON') {
      const doc = await vscode.workspace.openTextDocument({
        language: 'json',
        content: await kindStore.export([set.set.id]),
      });
      await vscode.window.showTextDocument(doc, { preview: false });
    } else if (action === 'View what it checks') {
      try {
        const compiled = compileSchema(set.set.format, set.set.text, set.set.identity);
        const doc = await vscode.workspace.openTextDocument({
          language: 'markdown',
          content: `# Schema preview\n\n\`\`\`\n${formatPreview(compiled.previews)}\n\`\`\`\n`,
        });
        await vscode.window.showTextDocument(doc, {
          viewColumn: vscode.ViewColumn.Beside,
          preview: true,
        });
      } catch (err) {
        void vscode.window.showWarningMessage(
          `k8s-manifestlens: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  reloadRules();
  refreshAll();
  void reloadKinds();

  context.subscriptions.push(
    vscode.commands.registerCommand('k8sManifestlens.addKind', (hint?: unknown) =>
      addKind(hint as KindHint | undefined),
    ),
    vscode.commands.registerCommand('k8sManifestlens.manageKinds', manageKinds),
    diagnostics,
    vscode.workspace.onDidOpenTextDocument(refresh),
    vscode.workspace.onDidChangeTextDocument((e) => refreshSoon(e.document)),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      diagnostics.delete(doc.uri);
      explained.delete(doc.uri.toString());
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('k8sManifestlens')) return;
      warnedAboutRules = false;
      reloadRules();
      vscode.workspace.textDocuments.forEach(refresh);
    }),
    vscode.languages.registerCodeActionsProvider('yaml', quickFixes, {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
    }),
    vscode.commands.registerCommand('k8sManifestlens.fixFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !looksLikeKubernetes(editor.document.getText())) {
        void vscode.window.showInformationMessage(
          'k8s-manifestlens: open a Kubernetes YAML file first.',
        );
        return;
      }
      const doc = editor.document;
      const plan = planFix(doc.getText(), rules, {
        maxRisk: config().get<FixRisk>('fixMaxRisk', 'low'),
        ...(policy ? { policy } : {}),
      });
      const { result } = plan;
      if (result.status !== 'fixed') {
        const why = result.skipped.length
          ? ` ${result.skipped.length} fix${result.skipped.length === 1 ? ' needs' : 'es need'} review or input (see the quick fixes, or raise k8sManifestlens.fixMaxRisk).`
          : '';
        void vscode.window.showInformationMessage(`k8s-manifestlens: no fixes to apply.${why}`);
        return;
      }
      // Preview first: show the proposed file next to the real one, and only then ask.
      const proposed = await vscode.workspace.openTextDocument({
        language: 'yaml',
        content: result.fixed,
      });
      await vscode.commands.executeCommand(
        'vscode.diff',
        doc.uri,
        proposed.uri,
        'k8s-manifestlens: proposed fixes',
      );
      const n = result.applied.length;
      const choice = await vscode.window.showInformationMessage(
        `k8s-manifestlens: apply ${n} fix${n === 1 ? '' : 'es'}? Undo with Ctrl+Z.`,
        'Apply',
      );
      if (choice !== 'Apply') return;
      if (isStale(result, doc.getText())) {
        void vscode.window.showWarningMessage(
          'k8s-manifestlens: the file changed since the preview. Nothing was applied; run the command again.',
        );
        return;
      }
      await vscode.workspace.applyEdit(toEdit(doc, plan));
    }),
    vscode.languages.registerHoverProvider('yaml', {
      provideHover(doc, position) {
        if (!config().get<boolean>('enable', true)) return undefined;
        const text = doc.getText();
        if (!looksLikeKubernetes(text)) return undefined;
        const key = doc.uri.toString();
        let cached = explained.get(key);
        if (cached?.version !== doc.version) {
          cached = { version: doc.version, result: explainManifest(text) };
          explained.set(key, cached);
        }
        const markdown = hoverMarkdown(cached.result, position.line + 1);
        return markdown ? new vscode.Hover(new vscode.MarkdownString(markdown)) : undefined;
      },
    }),
    vscode.commands.registerCommand('k8sManifestlens.explainFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !looksLikeKubernetes(editor.document.getText())) {
        void vscode.window.showInformationMessage(
          'k8s-manifestlens: open a Kubernetes YAML file first.',
        );
        return;
      }
      const doc = await vscode.workspace.openTextDocument({
        language: 'markdown',
        content: explainAsMarkdown(editor.document.getText()),
      });
      await vscode.window.showTextDocument(doc, {
        viewColumn: vscode.ViewColumn.Beside,
        preview: true,
      });
    }),
    { dispose: () => timers.forEach((t) => clearTimeout(t)) },
  );
}

export function deactivate(): void {}

/** Read rules from a YAML file, or from every .yaml/.yml file in a folder. */
function readRules(path: string): Rule[] {
  const files = statSync(path).isDirectory()
    ? readdirSync(path)
        .filter((f) => /\.ya?ml$/.test(f))
        .sort()
        .map((f) => join(path, f))
    : [path];
  return files.flatMap((f) => parseRules(readFileSync(f, 'utf8'), f));
}
