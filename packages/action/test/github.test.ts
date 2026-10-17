import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GITHUB_LIMIT_PER_LEVEL,
  emitAnnotations,
  selectAnnotations,
  spreadAcrossRules,
  upsertComment,
} from '../src/github.js';
import type { CommentTarget } from '../src/github.js';
import type { LocatedFinding } from '../src/types.js';

const target: CommentTarget = {
  apiUrl: 'https://api.example.com',
  repo: 'o/r',
  number: 7,
  token: 'secret-token',
};
const marker = '<!-- manifestlens-action -->';
const bot = (id: number, body: string) => ({ id, body, user: { type: 'Bot' } });

/** A fake GitHub API that records the calls it receives. */
function fakeApi(comments: unknown[][] = [[]], failWith?: number) {
  const calls: { method: string; url: string; body?: unknown; auth?: string | undefined }[] = [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({
      method,
      url: String(url),
      ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
      auth: (init?.headers as Record<string, string>).Authorization,
    });
    if (failWith) return new Response('no', { status: failWith });
    if (method === 'GET') {
      const page = Number(new URL(String(url)).searchParams.get('page'));
      return Response.json(comments[page - 1] ?? []);
    }
    return Response.json({ id: 99 });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

describe('upsertComment', () => {
  it('creates a comment when there is none', async () => {
    const { fetchFn, calls } = fakeApi();
    expect(await upsertComment(target, marker, `${marker}\nhi`, false, fetchFn)).toBe('created');
    expect(calls.map((c) => c.method)).toEqual(['GET', 'POST']);
    expect(calls[1]).toMatchObject({
      url: 'https://api.example.com/repos/o/r/issues/7/comments',
      body: { body: `${marker}\nhi` },
      auth: 'Bearer secret-token',
    });
  });

  it('updates the comment it wrote before, instead of adding another', async () => {
    const { fetchFn, calls } = fakeApi([[bot(5, `${marker}\nold`)]]);
    expect(await upsertComment(target, marker, `${marker}\nnew`, false, fetchFn)).toBe('updated');
    expect(calls[1]).toMatchObject({
      method: 'PATCH',
      url: 'https://api.example.com/repos/o/r/issues/comments/5',
    });
  });

  it('does nothing when the comment would not change', async () => {
    const { fetchFn, calls } = fakeApi([[bot(5, `${marker}\nsame`)]]);
    expect(await upsertComment(target, marker, `${marker}\nsame`, false, fetchFn)).toBe(
      'unchanged',
    );
    expect(calls).toHaveLength(1);
  });

  it('can be told not to create a comment, only to update one', async () => {
    const none = fakeApi();
    expect(await upsertComment(target, marker, 'x', true, none.fetchFn)).toBe('skipped');
    expect(none.calls).toHaveLength(1);
    const some = fakeApi([[bot(5, `${marker} old`)]]);
    expect(await upsertComment(target, marker, `${marker} all clear`, true, some.fetchFn)).toBe(
      'updated',
    );
  });

  it('ignores a marker in a comment written by a person', async () => {
    const { fetchFn, calls } = fakeApi([
      [{ id: 3, body: `${marker} fake`, user: { type: 'User' } }],
    ]);
    expect(await upsertComment(target, marker, 'x', false, fetchFn)).toBe('created');
    expect(calls.map((c) => c.method)).toEqual(['GET', 'POST']);
  });

  it('looks through several pages of comments', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => bot(i + 1, 'unrelated'));
    const { fetchFn, calls } = fakeApi([page1, [bot(500, `${marker} old`)]]);
    expect(await upsertComment(target, marker, `${marker} new`, false, fetchFn)).toBe('updated');
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(2);
    expect(calls.at(-1)?.url).toContain('/issues/comments/500');
  });

  it('throws a clear error when GitHub refuses, so the caller can warn', async () => {
    const { fetchFn } = fakeApi([[]], 403);
    await expect(upsertComment(target, marker, 'x', false, fetchFn)).rejects.toThrow(
      'GitHub API GET /issues/7/comments?per_page=100&page=1 returned 403',
    );
  });

  it('never puts the token in an error', async () => {
    const { fetchFn } = fakeApi([[]], 500);
    await expect(upsertComment(target, marker, 'x', false, fetchFn)).rejects.not.toThrow(
      /secret-token/,
    );
  });
});

const find = (
  severity: LocatedFinding['severity'],
  line: number,
  ruleId = `rule-${line}`,
): LocatedFinding => ({
  file: 'k8s/a.yaml',
  line,
  ruleId,
  severity,
  message: 'msg',
  fix: 'Do this.',
});
const many = (severity: LocatedFinding['severity'], n: number, ruleId?: string) =>
  Array.from({ length: n }, (_, i) => find(severity, i + 1, ruleId));

describe('spreadAcrossRules', () => {
  it('takes one finding per rule before taking a second of any', () => {
    const list = [
      find('warning', 1, 'a'),
      find('warning', 2, 'a'),
      find('warning', 3, 'a'),
      find('warning', 4, 'b'),
      find('warning', 5, 'b'),
      find('warning', 6, 'c'),
    ];
    expect(spreadAcrossRules(list, 3).map((f) => f.line)).toEqual([1, 4, 6]);
    expect(spreadAcrossRules(list, 5).map((f) => f.line)).toEqual([1, 2, 4, 5, 6]);
  });

  it('keeps the original order, and returns everything when the limit is large', () => {
    const list = [find('info', 1, 'a'), find('info', 2, 'b'), find('info', 3, 'a')];
    expect(spreadAcrossRules(list, 10)).toEqual(list);
    expect(spreadAcrossRules(list, 0)).toEqual([]);
  });
});

describe('selectAnnotations: GitHub shows at most 10 of each severity per step', () => {
  const count = (sel: ReturnType<typeof selectAnnotations>, sev: LocatedFinding['severity']) =>
    sel.findings.filter((f) => f.severity === sev).length;

  it('knows the limit', () => {
    expect(GITHUB_LIMIT_PER_LEVEL).toBe(10);
  });

  it('never asks for more than 10 of one severity, so each severity gets its share', () => {
    const sel = selectAnnotations(
      [...many('error', 12), ...many('warning', 25), ...many('info', 15)],
      [],
      30,
    );
    expect([count(sel, 'error'), count(sel, 'warning'), count(sel, 'info')]).toEqual([10, 10, 10]);
  });

  it('shows info findings even when there are hundreds of warnings', () => {
    const sel = selectAnnotations([...many('warning', 900), ...many('info', 400)], [], 30);
    expect([count(sel, 'warning'), count(sel, 'info')]).toEqual([10, 10]);
  });

  it('respects a smaller total, most severe first', () => {
    const sel = selectAnnotations(
      [...many('error', 12), ...many('warning', 25), ...many('info', 15)],
      [],
      25,
    );
    expect([count(sel, 'error'), count(sel, 'warning'), count(sel, 'info')]).toEqual([10, 10, 5]);
    const small = selectAnnotations([...many('error', 12), ...many('warning', 5)], [], 3);
    expect([count(small, 'error'), count(small, 'warning')]).toEqual([3, 0]);
  });

  it('counts unreadable YAML as errors', () => {
    const problems = Array.from({ length: 4 }, (_, i) => ({
      file: 'bad.yaml',
      line: i + 1,
      message: 'oops',
    }));
    const sel = selectAnnotations(many('error', 12), problems, 30);
    expect(sel.problems).toHaveLength(4);
    expect(count(sel, 'error')).toBe(6);
  });

  it('spreads each severity across the rules that fired', () => {
    const warnings = [
      ...many('warning', 40, 'common'),
      find('warning', 100, 'rare-1'),
      find('warning', 101, 'rare-2'),
    ];
    const rules = new Set(selectAnnotations(warnings, [], 30).findings.map((f) => f.ruleId));
    expect(rules).toEqual(new Set(['common', 'rare-1', 'rare-2']));
  });

  it('does nothing at a cap of zero or with nothing to show', () => {
    expect(selectAnnotations(many('error', 3), [], 0)).toEqual({ problems: [], findings: [] });
    expect(selectAnnotations([], [], 30)).toEqual({ problems: [], findings: [] });
  });
});

describe('emitAnnotations', () => {
  const out: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    out.push(String(chunk));
    return true;
  });
  afterEach(() => {
    out.length = 0;
  });

  it('creates an error, warning or notice at the right file and line, and reports the counts', () => {
    const result = emitAnnotations([find('error', 3), find('warning', 4), find('info', 5)], [], 10);
    const text = out.join('');
    expect(result).toEqual({ emitted: 3, total: 3 });
    expect(text).toContain(
      '::error title=ManifestLens%3A rule-3,file=k8s/a.yaml,line=3::msg Do this.',
    );
    expect(text).toContain('::warning title=ManifestLens%3A rule-4,file=k8s/a.yaml,line=4::');
    expect(text).toContain('::notice title=ManifestLens%3A rule-5,file=k8s/a.yaml,line=5::');
  });

  it('asks GitHub for no more than it will show, and says how many were left out', () => {
    const result = emitAnnotations([...many('warning', 25), ...many('info', 25)], [], 30);
    expect(result).toEqual({ emitted: 20, total: 50 });
    expect(out.join('').match(/::warning /g)).toHaveLength(10);
    expect(out.join('').match(/::notice /g)).toHaveLength(10);
  });

  it('shows unreadable YAML first, and creates nothing at a cap of zero', () => {
    emitAnnotations([find('error', 1)], [{ file: 'bad.yaml', line: 2, message: 'oops' }], 5);
    expect(out.join('').indexOf('invalid YAML')).toBeLessThan(out.join('').indexOf('rule-1'));
    out.length = 0;
    expect(emitAnnotations([find('error', 1)], [], 0)).toEqual({ emitted: 0, total: 1 });
    expect(out).toEqual([]);
  });

  it('is restored after the suite', () => {
    spy.mockRestore();
    expect(true).toBe(true);
  });
});
