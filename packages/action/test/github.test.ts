import { afterEach, describe, expect, it, vi } from 'vitest';
import { emitAnnotations, upsertComment } from '../src/github.js';
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

describe('emitAnnotations', () => {
  const out: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    out.push(String(chunk));
    return true;
  });
  afterEach(() => {
    out.length = 0;
  });

  const f = (severity: LocatedFinding['severity'], line: number): LocatedFinding => ({
    file: 'k8s/a.yaml',
    line,
    ruleId: `rule-${line}`,
    severity,
    message: 'msg',
    fix: 'Do this.',
  });

  it('creates an error, warning or notice at the right file and line', () => {
    const n = emitAnnotations([f('error', 3), f('warning', 4), f('info', 5)], [], 10);
    const text = out.join('');
    expect(n).toBe(3);
    expect(text).toContain(
      '::error title=ManifestLens%3A rule-3,file=k8s/a.yaml,line=3::msg Do this.',
    );
    expect(text).toContain('::warning title=ManifestLens%3A rule-4,file=k8s/a.yaml,line=4::');
    expect(text).toContain('::notice title=ManifestLens%3A rule-5,file=k8s/a.yaml,line=5::');
  });

  it('stops at the cap, keeping the most severe first', () => {
    const n = emitAnnotations([f('error', 1), f('error', 2), f('warning', 3)], [], 2);
    expect(n).toBe(2);
    expect(out.join('')).not.toContain('warning');
  });

  it('shows unreadable YAML first, and creates nothing at a cap of zero', () => {
    emitAnnotations([f('error', 1)], [{ file: 'bad.yaml', line: 2, message: 'oops' }], 5);
    expect(out.join('').indexOf('invalid YAML')).toBeLessThan(out.join('').indexOf('rule-1'));
    out.length = 0;
    expect(emitAnnotations([f('error', 1)], [], 0)).toBe(0);
    expect(out).toEqual([]);
  });

  it('is restored after the suite', () => {
    spy.mockRestore();
    expect(true).toBe(true);
  });
});
