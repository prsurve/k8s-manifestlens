import type { Settings } from './types.js';

export interface Base {
  ref: string;
  /** Where the ref came from, for the log and the summary. */
  source: string;
}

const ZEROS = /^0+$/;

/**
 * What to compare against for `changed` and `new`. An explicit `base-ref` wins; otherwise the
 * workflow event says: the base of a pull request, the commit before a push, or a merge queue's base.
 */
export function determineBase(s: Settings, eventName: string, event: unknown): Base | null {
  if (s.baseRef !== '') return { ref: s.baseRef, source: 'base-ref input' };

  const e = (event ?? {}) as {
    pull_request?: { base?: { sha?: unknown } };
    before?: unknown;
    merge_group?: { base_sha?: unknown };
  };
  const sha = (v: unknown): string | null =>
    typeof v === 'string' && /^[0-9a-f]{7,64}$/i.test(v) && !ZEROS.test(v) ? v : null;

  if (eventName === 'pull_request' || eventName === 'pull_request_target') {
    const base = sha(e.pull_request?.base?.sha);
    if (base) return { ref: base, source: 'the pull request base' };
  }
  if (eventName === 'merge_group') {
    const base = sha(e.merge_group?.base_sha);
    if (base) return { ref: base, source: 'the merge group base' };
  }
  if (eventName === 'push') {
    const before = sha(e.before);
    if (before) return { ref: before, source: 'the commit before this push' };
  }
  return null;
}
