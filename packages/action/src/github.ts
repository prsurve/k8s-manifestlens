import * as core from '@actions/core';
import type { LocatedFinding, ParseProblem } from './types.js';

/**
 * Show findings on the changed lines of a pull request. GitHub limits how many annotations one step
 * may create, so the most severe go first and `max` caps the rest.
 */
export function emitAnnotations(
  findings: LocatedFinding[],
  problems: ParseProblem[],
  max: number,
): number {
  let used = 0;
  for (const p of problems) {
    if (used >= max) break;
    core.error(p.message, {
      title: 'ManifestLens: invalid YAML',
      file: p.file,
      startLine: p.line ?? 1,
    });
    used++;
  }
  for (const f of findings) {
    if (used >= max) break;
    const props = { title: `ManifestLens: ${f.ruleId}`, file: f.file, startLine: f.line };
    const text = f.fix ? `${f.message} ${f.fix}` : f.message;
    if (f.severity === 'error') core.error(text, props);
    else if (f.severity === 'warning') core.warning(text, props);
    else core.notice(text, props);
    used++;
  }
  return used;
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
