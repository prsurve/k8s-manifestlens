import { fixManifest, unifiedDiff } from '@k8s-manifestlens/core';
import type { AppliedFix, FixPolicy, Rule, SkippedFix } from '@k8s-manifestlens/core';
import type { FileToAnalyze } from './analyze.js';
import type { Analysis, Settings } from './types.js';

export interface FileFixes {
  file: string;
  applied: AppliedFix[];
  skipped: SkippedFix[];
  /** Unified diff of this file's fixes, or `''`. */
  patch: string;
}

/** What the fix engine would do. The action only reports this; it never edits a file. */
export interface FixSuggestions {
  maxRisk: Settings['fixMaxRisk'];
  files: FileFixes[];
  /** Fixes that validated and are in the patch. */
  available: number;
  /** Fixes held back: too risky, missing policy values, unsafe layout. */
  heldBack: number;
  /** All file patches joined; empty when there is nothing to fix. */
  patch: string;
}

/**
 * Work out fixes for the findings the analysis kept, so ignores, disabled rules and the `scope`
 * setting decide what is fixed exactly as they decide what is reported.
 */
export function suggestFixes(
  files: FileToAnalyze[],
  rules: Rule[],
  analysis: Analysis,
  s: Settings,
  policy: FixPolicy | undefined,
): FixSuggestions {
  const byId = new Map(rules.map((r) => [r.id, r]));
  const out: FixSuggestions = {
    maxRisk: s.fixMaxRisk,
    files: [],
    available: 0,
    heldBack: 0,
    patch: '',
  };

  for (const file of files) {
    const wanted = analysis.findings
      .filter((f) => f.file === file.path && byId.get(f.ruleId)?.autofix !== undefined)
      .map((f) => ({ ruleId: f.ruleId, line: f.line }));
    if (wanted.length === 0) continue;

    const result = fixManifest(file.text, rules, {
      maxRisk: s.fixMaxRisk,
      findings: wanted,
      ...(policy ? { policy } : {}),
    });
    const patch = unifiedDiff(result.original, result.fixed, `a/${file.path}`, `b/${file.path}`);
    out.available += result.applied.length;
    out.heldBack += result.skipped.length;
    out.patch += patch;
    if (result.applied.length > 0 || result.skipped.length > 0) {
      out.files.push({ file: file.path, applied: result.applied, skipped: result.skipped, patch });
    }
  }
  return out;
}
