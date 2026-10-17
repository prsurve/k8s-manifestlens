import { thresholds } from './settings.js';
import type { Analysis, Settings } from './types.js';

export interface Counts {
  error: number;
  warning: number;
  info: number;
  total: number;
  parseErrors: number;
}

export type Result = 'pass' | 'fail' | 'report' | 'dry-run';

export interface Verdict {
  /** Whether the rules are satisfied, regardless of mode. */
  passed: boolean;
  /** What happens to the build: fail, or one of the non-blocking outcomes. */
  result: Result;
  /** Whether the step should exit non-zero. */
  blocking: boolean;
  /** One line per violated rule, for the log and the summary. */
  reasons: string[];
  counts: Counts;
}

export function countFindings(a: Analysis): Counts {
  const n = (sev: string): number => a.findings.filter((f) => f.severity === sev).length;
  return {
    error: n('error'),
    warning: n('warning'),
    info: n('info'),
    total: a.findings.length,
    parseErrors: a.parseProblems.length,
  };
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The success criteria. The run passes unless a severity exceeds its allowance, the total exceeds
 * `max-total`, or a manifest could not be parsed (unless `fail-on-parse-error` is off).
 * `mode: report` and `dry-run` still say what was violated, but never block the build.
 */
export function evaluate(a: Analysis, s: Settings): Verdict {
  const counts = countFindings(a);
  const limit = thresholds(s);
  const reasons: string[] = [];

  for (const sev of ['error', 'warning', 'info'] as const) {
    const max = limit[sev];
    if (max !== null && counts[sev] > max) {
      reasons.push(
        `${plural(counts[sev], sev)} found, ${max === 0 ? 'none allowed' : `at most ${max} allowed`}.`,
      );
    }
  }
  if (limit.total !== null && counts.total > limit.total) {
    reasons.push(`${plural(counts.total, 'finding')} in total, at most ${limit.total} allowed.`);
  }
  if (s.failOnParseError && counts.parseErrors > 0) {
    reasons.push(
      `${plural(counts.parseErrors, 'manifest problem')} (invalid YAML or an unreadable document).`,
    );
  }

  const passed = reasons.length === 0;
  const result: Result = passed
    ? 'pass'
    : s.dryRun
      ? 'dry-run'
      : s.mode === 'report'
        ? 'report'
        : 'fail';
  return { passed, result, blocking: result === 'fail', reasons, counts };
}
