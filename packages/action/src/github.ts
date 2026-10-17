import * as core from '@actions/core';
import type { LocatedFinding, ParseProblem } from './types.js';

/** GitHub shows at most this many annotations of each severity (error, warning, notice) per step. */
export const GITHUB_LIMIT_PER_LEVEL = 10;

/**
 * Pick up to `limit` findings, taking one per rule before a second of any, so a long run of the same
 * finding does not crowd out the others. The original order is kept.
 */
export function spreadAcrossRules(findings: LocatedFinding[], limit: number): LocatedFinding[] {
  if (limit <= 0) return [];
  if (findings.length <= limit) return findings;

  const byRule = new Map<string, number[]>();
  findings.forEach((f, i) => {
    const group = byRule.get(f.ruleId);
    if (group) group.push(i);
    else byRule.set(f.ruleId, [i]);
  });

  const picked: number[] = [];
  for (let round = 0; picked.length < limit; round++) {
    let any = false;
    for (const indexes of byRule.values()) {
      if (round >= indexes.length) continue;
      picked.push(indexes[round] as number);
      any = true;
      if (picked.length === limit) break;
    }
    if (!any) break;
  }
  return picked.sort((x, y) => x - y).map((i) => findings[i] as LocatedFinding);
}

/**
 * Choose what to annotate. GitHub keeps only 10 of each severity per step and drops the rest silently,
 * so asking for more wastes the slots: hundreds of warnings would push every info finding out. Each
 * severity gets up to 10, errors first, and `max` caps the total. Unreadable YAML counts as errors.
 */
export function selectAnnotations(
  findings: LocatedFinding[],
  problems: ParseProblem[],
  max: number,
): { problems: ParseProblem[]; findings: LocatedFinding[] } {
  let budget = Math.max(max, 0);
  const keptProblems = problems.slice(0, Math.min(GITHUB_LIMIT_PER_LEVEL, budget));
  budget -= keptProblems.length;

  const picked: LocatedFinding[] = [];
  for (const level of ['error', 'warning', 'info'] as const) {
    const taken = level === 'error' ? keptProblems.length : 0;
    const room = Math.min(GITHUB_LIMIT_PER_LEVEL - taken, budget);
    const chosen = spreadAcrossRules(
      findings.filter((f) => f.severity === level),
      room,
    );
    picked.push(...chosen);
    budget -= chosen.length;
  }
  return { problems: keptProblems, findings: picked };
}

/** Show findings on the changed lines of a pull request. Returns how many were shown and how many there were. */
export function emitAnnotations(
  findings: LocatedFinding[],
  problems: ParseProblem[],
  max: number,
): { emitted: number; total: number } {
  const chosen = selectAnnotations(findings, problems, max);
  for (const p of chosen.problems) {
    core.error(p.message, {
      title: 'ManifestLens: invalid YAML',
      file: p.file,
      startLine: p.line ?? 1,
    });
  }
  for (const f of chosen.findings) {
    const props = { title: `ManifestLens: ${f.ruleId}`, file: f.file, startLine: f.line };
    const text = f.fix ? `${f.message} ${f.fix}` : f.message;
    if (f.severity === 'error') core.error(text, props);
    else if (f.severity === 'warning') core.warning(text, props);
    else core.notice(text, props);
  }
  return {
    emitted: chosen.problems.length + chosen.findings.length,
    total: problems.length + findings.length,
  };
}

export interface CommentTarget {
  apiUrl: string;
  repo: string;
  number: number;
  token: string;
}

export type CommentOutcome = 'created' | 'updated' | 'unchanged' | 'skipped';

interface ApiComment {
  id: number;
  body?: string;
  user?: { type?: string };
}

type Fetch = typeof fetch;

async function api<T>(
  fetchFn: Fetch,
  target: CommentTarget,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetchFn(`${target.apiUrl}/repos/${target.repo}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${target.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'manifestlens-action',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`GitHub API ${method} ${path} returned ${res.status}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/**
 * Create the pull request comment, or update the one this action wrote earlier (found by `marker`),
 * so repeated runs do not pile up comments. With `onlyIfExists`, a missing comment is left uncreated.
 */
export async function upsertComment(
  target: CommentTarget,
  marker: string,
  body: string,
  onlyIfExists: boolean,
  fetchFn: Fetch = fetch,
): Promise<CommentOutcome> {
  let existing: ApiComment | undefined;
  for (let page = 1; page <= 10 && !existing; page++) {
    const batch = await api<ApiComment[]>(
      fetchFn,
      target,
      'GET',
      `/issues/${target.number}/comments?per_page=100&page=${page}`,
    );
    existing = batch.find((c) => c.user?.type === 'Bot' && c.body?.includes(marker));
    if (batch.length < 100) break;
  }
  if (existing) {
    if (existing.body === body) return 'unchanged';
    await api(fetchFn, target, 'PATCH', `/issues/comments/${existing.id}`, { body });
    return 'updated';
  }
  if (onlyIfExists) return 'skipped';
  await api(fetchFn, target, 'POST', `/issues/${target.number}/comments`, { body });
  return 'created';
}
