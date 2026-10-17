import { readFileSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import * as vscode from 'vscode';
import { explainManifest, loadBundledRules, parseRules } from '@manifestlens/core';
import type { ExplainResult, Rule, Severity } from '@manifestlens/core';
import { explainAsMarkdown, findProblems, hoverMarkdown, looksLikeKubernetes } from './logic.js';

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
  }

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
