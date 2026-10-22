import { readFileSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import * as vscode from 'vscode';
import {
  explainManifest,
  isStale,
  loadBundledRules,
  parseFixPolicy,
  parseRules,
} from '@manifestlens/core';
import type { ExplainResult, FixPolicy, FixRisk, Rule, Severity } from '@manifestlens/core';
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

export function activate(context: vscode.ExtensionContext): void {
  const diagnostics = vscode.languages.createDiagnosticCollection('manifestlens');
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const explained = new Map<string, { version: number; result: ExplainResult }>();
  let rules: Rule[] = loadBundledRules();
  let warnedAboutRules = false;
  let policy: FixPolicy | undefined;

  const config = () => vscode.workspace.getConfiguration('manifestlens');

  function reloadRules(): void {
    rules = loadBundledRules();
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    for (const path of config().get<string[]>('rules', [])) {
      try {
        rules.push(...readRules(isAbsolute(path) || !folder ? path : join(folder, path)));
      } catch (err) {
        if (!warnedAboutRules) {
          warnedAboutRules = true;
          void vscode.window.showWarningMessage(
            `ManifestLens: ${err instanceof Error ? err.message : String(err)}`,
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
          `ManifestLens: ${err instanceof Error ? err.message : String(err)}`,
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
        if (diagnostic.source !== 'ManifestLens' || typeof diagnostic.code !== 'string') continue;
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
        d.source = 'ManifestLens';
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

  reloadRules();
  vscode.workspace.textDocuments.forEach(refresh);

  context.subscriptions.push(
    diagnostics,
    vscode.workspace.onDidOpenTextDocument(refresh),
    vscode.workspace.onDidChangeTextDocument((e) => refreshSoon(e.document)),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      diagnostics.delete(doc.uri);
      explained.delete(doc.uri.toString());
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('manifestlens')) return;
      warnedAboutRules = false;
      reloadRules();
      vscode.workspace.textDocuments.forEach(refresh);
    }),
    vscode.languages.registerCodeActionsProvider('yaml', quickFixes, {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
    }),
    vscode.commands.registerCommand('manifestlens.fixFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !looksLikeKubernetes(editor.document.getText())) {
        void vscode.window.showInformationMessage(
          'ManifestLens: open a Kubernetes YAML file first.',
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
          ? ` ${result.skipped.length} fix${result.skipped.length === 1 ? ' needs' : 'es need'} review or input (see the quick fixes, or raise manifestlens.fixMaxRisk).`
          : '';
        void vscode.window.showInformationMessage(`ManifestLens: no fixes to apply.${why}`);
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
        'ManifestLens: proposed fixes',
      );
      const n = result.applied.length;
      const choice = await vscode.window.showInformationMessage(
        `ManifestLens: apply ${n} fix${n === 1 ? '' : 'es'}? Undo with Ctrl+Z.`,
        'Apply',
      );
      if (choice !== 'Apply') return;
      if (isStale(result, doc.getText())) {
        void vscode.window.showWarningMessage(
          'ManifestLens: the file changed since the preview. Nothing was applied; run the command again.',
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
    vscode.commands.registerCommand('manifestlens.explainFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !looksLikeKubernetes(editor.document.getText())) {
        void vscode.window.showInformationMessage(
          'ManifestLens: open a Kubernetes YAML file first.',
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
