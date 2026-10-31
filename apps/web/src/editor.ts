import { explainManifest } from '@k8s-manifestlens/core';
import { el } from './dom.js';

/** Fixed row height in px. The gutter, the highlight layer and the text box all use it, so rows line up. */
export const LINE_HEIGHT = 20;
/** Above this many lines the colouring is skipped; line numbers and the current-line mark stay. */
const HIGHLIGHT_LIMIT = 4000;

export interface Token {
  cls: 'key' | 'str' | 'num' | 'lit' | 'com' | 'dash' | 'plain';
  text: string;
}

const KEY = /^(\s*(?:-\s+)*)((?:"[^"]*"|'[^']*'|[^\s:#"'][^:#]*?))(:)(?=\s|$)/;

/** Split one YAML line into colour classes. A cosmetic approximation: it never changes the text. */
export function tokenizeLine(line: string): Token[] {
  const out: Token[] = [];
  const push = (cls: Token['cls'], text: string | undefined): void => {
    if (text) out.push({ cls, text });
  };

  const value = (s: string): void => {
    const [, lead = '', v = '', tail = ''] = /^(\s*)(.*?)(\s*)$/.exec(s) ?? [];
    push('plain', lead);
    if (/^("([^"\\]|\\.)*"|'[^']*')$/.test(v)) push('str', v);
    else if (/^[-+]?(\d[\d_]*)(\.\d+)?([eE][-+]?\d+)?$/.test(v)) push('num', v);
    else if (/^(true|false|null|~|yes|no)$/i.test(v) || /^[&*!]/.test(v)) push('lit', v);
    else push('plain', v);
    push('plain', tail);
  };
  const withComment = (s: string): void => {
    const hit = /(^|\s)#/.exec(s);
    if (!hit) return value(s);
    const at = hit.index + (hit[1]?.length ?? 0);
    value(s.slice(0, at));
    push('com', s.slice(at));
  };

  if (/^\s*#/.test(line) || /^(---|\.\.\.)\s*$/.test(line)) {
    push(line.trimStart().startsWith('#') ? 'com' : 'dash', line);
    return out;
  }
  const key = KEY.exec(line);
  if (key) {
    const [whole, lead = '', name = '', colon = ''] = key;
    const [, indent = '', dashes = ''] = /^(\s*)((?:-\s+)*)$/.exec(lead) ?? [];
    push('plain', indent);
    push('dash', dashes);
    push('key', name);
    push('plain', colon);
    withComment(line.slice(whole.length));
    return out;
  }
  const item = /^(\s*)(-)(\s+)(.*)$/.exec(line);
  if (item) {
    push('plain', item[1]);
    push('dash', item[2]);
    push('plain', item[3]);
    withComment(item[4] ?? '');
    return out;
  }
  withComment(line);
  return out;
}

/** 1-based line the caret (or the start of the selection) is on. */
export function caretLine(box: HTMLTextAreaElement): number {
  let n = 1;
  const upTo = box.selectionStart ?? 0;
  for (let i = box.value.indexOf('\n'); i !== -1 && i < upTo; i = box.value.indexOf('\n', i + 1))
    n++;
  return n;
}

export interface ManifestInfo {
  documents: number;
  kinds: { kind: string; apiVersion: string | undefined }[];
}

/** What a manifest holds, using the same parser as Explain. */
export function manifestInfo(text: string): ManifestInfo {
  if (text.trim() === '') return { documents: 0, kinds: [] };
  const docs = explainManifest(text).documents;
  return {
    documents: docs.length,
    kinds: docs.flatMap((d) => (d.kind ? [{ kind: d.kind, apiVersion: d.apiVersion }] : [])),
  };
}

/** "Lines: 20 | Kind: Deployment | apiVersion: apps/v1", or an empty string for an empty box. */
export function describeMeta(text: string, info: ManifestInfo): string {
  if (text.trim() === '') return '';
  const parts = [`Lines: ${text.replace(/\n$/, '').split('\n').length}`];
  const names = [...new Set(info.kinds.map((k) => k.kind))];
  const first = info.kinds[0];
  if (names.length === 1 && info.kinds.length === 1 && first) {
    parts.push(`Kind: ${first.kind}`);
    if (first.apiVersion) parts.push(`apiVersion: ${first.apiVersion}`);
  } else if (names.length > 0) {
    parts.push(
      `Kinds: ${names.length > 4 ? `${names.slice(0, 4).join(', ')}, …` : names.join(', ')}`,
    );
  }
  return parts.join(' | ');
}

export interface Editor {
  box: HTMLTextAreaElement;
  /** Redraw numbers and colours after the value was set from code. */
  refresh: () => void;
  /** Mark a line as current and scroll it into view; optionally move the caret there. */
  select: (line: number, focus: boolean) => void;
  /** Called when the caret moves to another line. */
  onLine: (fn: (line: number) => void) => void;
  line: () => number;
}

/**
 * Wrap a plain <textarea> with line numbers, YAML colours and a current-line mark. The textarea stays
 * the real control (typing, selection, undo, IME all behave natively); the colours are drawn in a
 * layer underneath its transparent text.
 */
export function enhanceTextarea(box: HTMLTextAreaElement): Editor {
  const gutterInner = el('div', { class: 'gutter-inner' });
  const gutter = el('div', { class: 'gutter', attrs: { 'aria-hidden': 'true' } }, [gutterInner]);
  const mark = el('div', { class: 'line-mark' });
  const code = el('div', { class: 'code-layer' });
  const backdropInner = el('div', { class: 'backdrop-inner' }, [mark, code]);
  const backdrop = el('div', { class: 'backdrop', attrs: { 'aria-hidden': 'true' } }, [
    backdropInner,
  ]);
  const wrap = el('div', { class: 'editor' }, [gutter, el('div', { class: 'code-wrap' })]);

  box.setAttribute('wrap', 'off');
  box.parentElement?.insertBefore(wrap, box);
  const codeWrap = wrap.querySelector('.code-wrap') as HTMLElement;
  codeWrap.append(backdrop, box);
  box.classList.add('editor-input');

  let current = 1;
  let listener: (line: number) => void = () => undefined;
  let drawn = -1;

  const paintMark = (): void => {
    mark.style.top = `${(current - 1) * LINE_HEIGHT}px`;
    gutterInner.querySelector('.cur')?.classList.remove('cur');
    gutterInner.children[current - 1]?.classList.add('cur');
  };

  const refresh = (): void => {
    const lines = box.value.split('\n');
    if (lines.length !== drawn) {
      drawn = lines.length;
      gutterInner.replaceChildren(
        ...lines.map((_, i) => el('div', { class: 'gn', text: String(i + 1) })),
      );
    }
    const fragment = document.createDocumentFragment();
    const colour = lines.length <= HIGHLIGHT_LIMIT;
    for (const line of lines) {
      const row = el('div', { class: 'cl' });
      if (colour) {
        for (const t of tokenizeLine(line))
          row.append(el('span', { class: `t-${t.cls}`, text: t.text }));
      } else row.textContent = line;
      if (line === '') row.textContent = ' ';
      fragment.append(row);
    }
    code.replaceChildren(fragment);
    current = Math.min(current, lines.length);
    paintMark();
    sync();
  };

  const sync = (): void => {
    const t = `translate(${-box.scrollLeft}px, ${-box.scrollTop}px)`;
    backdropInner.style.transform = t;
    gutterInner.style.transform = `translateY(${-box.scrollTop}px)`;
  };

  const caretMoved = (): void => {
    const line = caretLine(box);
    if (line === current) return;
    current = line;
    paintMark();
    listener(line);
  };

  box.addEventListener('scroll', sync);
  box.addEventListener('input', () => {
    refresh();
    caretMoved();
  });
  for (const ev of ['keyup', 'click', 'focus'] as const) box.addEventListener(ev, caretMoved);
  document.addEventListener('selectionchange', () => {
    if (document.activeElement === box) caretMoved();
  });

  const select = (line: number, focus: boolean): void => {
    const lines = box.value.split('\n');
    const n = Math.max(1, Math.min(line, lines.length));
    let start = 0;
    for (let i = 0; i < n - 1; i++) start += (lines[i]?.length ?? 0) + 1;
    if (focus) box.focus({ preventScroll: true });
    box.setSelectionRange(start, start + (lines[n - 1]?.length ?? 0));
    current = n;
    paintMark();
    const top = (n - 1) * LINE_HEIGHT;
    if (top < box.scrollTop || top > box.scrollTop + box.clientHeight - LINE_HEIGHT * 2)
      box.scrollTop = Math.max(0, top - box.clientHeight / 2);
    sync();
    listener(n);
  };

  refresh();
  return {
    box,
    refresh,
    select,
    onLine: (fn) => (listener = fn),
    line: () => current,
  };
}
