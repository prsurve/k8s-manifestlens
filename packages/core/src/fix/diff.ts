export interface LineOp {
  type: 'same' | 'del' | 'add';
  text: string;
}

/** A change in line terms: replace `deleteCount` lines of the old text starting at `start` (0-based). Lines keep their terminators, so `insert.join('')` is the replacement text. */
export interface LineEdit {
  start: number;
  deleteCount: number;
  insert: string[];
}

/** Lines keep their terminator (`\n` or `\r\n`), so a missing final newline shows up as a change. */
function split(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

const MAX_CELLS = 4_000_000;

/** Line diff: common head and tail are skipped, the middle is matched with a longest common subsequence. */
export function diffLines(oldText: string, newText: string): LineOp[] {
  const a = split(oldText);
  const b = split(newText);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++;
  }
  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);

  const ops: LineOp[] = a.slice(0, head).map((text) => ({ type: 'same', text }));
  ops.push(...middle(midA, midB));
  ops.push(...a.slice(a.length - tail).map((text): LineOp => ({ type: 'same', text })));
  return ops;
}

function middle(a: string[], b: string[]): LineOp[] {
  if (a.length === 0) return b.map((text) => ({ type: 'add', text }));
  if (b.length === 0) return a.map((text) => ({ type: 'del', text }));
  if (a.length * b.length > MAX_CELLS) {
    return [
      ...a.map((text): LineOp => ({ type: 'del', text })),
      ...b.map((text): LineOp => ({ type: 'add', text })),
    ];
  }
  const w = b.length + 1;
  const table = new Uint32Array((a.length + 1) * w);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * w + j] =
        a[i] === b[j]
          ? (table[(i + 1) * w + j + 1] as number) + 1
          : Math.max(table[(i + 1) * w + j] as number, table[i * w + j + 1] as number);
    }
  }
  const ops: LineOp[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ type: 'same', text: a[i] as string });
      i++;
      j++;
    } else if ((table[(i + 1) * w + j] as number) >= (table[i * w + j + 1] as number)) {
      ops.push({ type: 'del', text: a[i++] as string });
    } else {
      ops.push({ type: 'add', text: b[j++] as string });
    }
  }
  while (i < a.length) ops.push({ type: 'del', text: a[i++] as string });
  while (j < b.length) ops.push({ type: 'add', text: b[j++] as string });
  return ops;
}

/** The changes between two texts as line edits against the old text, in order. */
export function lineEdits(oldText: string, newText: string): LineEdit[] {
  const edits: LineEdit[] = [];
  let line = 0;
  let current: LineEdit | undefined;
  for (const op of diffLines(oldText, newText)) {
    if (op.type === 'same') {
      current = undefined;
      line++;
      continue;
    }
    current ??= edits[edits.push({ start: line, deleteCount: 0, insert: [] }) - 1];
    if (op.type === 'del') {
      (current as LineEdit).deleteCount++;
      line++;
    } else {
      (current as LineEdit).insert.push(op.text);
    }
  }
  return edits;
}

/**
 * A unified diff that `git apply` and `patch -p1` accept. Returns `''` when the texts are equal.
 * Labels are used as given, so pass `a/path` and `b/path` for repository patches.
 */
export function unifiedDiff(
  oldText: string,
  newText: string,
  oldLabel = 'a/manifest.yaml',
  newLabel = 'b/manifest.yaml',
  context = 3,
): string {
  if (oldText === newText) return '';
  const ops = diffLines(oldText, newText);

  const changed = ops.flatMap((op, i) => (op.type === 'same' ? [] : [i]));
  const hunks: [number, number][] = [];
  for (const i of changed) {
    const from = Math.max(i - context, 0);
    const to = Math.min(i + context, ops.length - 1);
    const last = hunks[hunks.length - 1];
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to);
    else hunks.push([from, to]);
  }

  const out = [`--- ${oldLabel}`, `+++ ${newLabel}`];
  let oldLine = 1;
  let newLine = 1;
  let cursor = 0;
  for (const [from, to] of hunks) {
    for (; cursor < from; cursor++) {
      const type = (ops[cursor] as LineOp).type;
      if (type !== 'add') oldLine++;
      if (type !== 'del') newLine++;
    }
    const body: string[] = [];
    let oldCount = 0;
    let newCount = 0;
    for (let i = from; i <= to; i++) {
      const op = ops[i] as LineOp;
      const mark = op.type === 'same' ? ' ' : op.type === 'del' ? '-' : '+';
      body.push(`${mark}${op.text.replace(/\n$/, '')}`);
      if (!op.text.endsWith('\n')) body.push('\\ No newline at end of file');
      if (op.type !== 'add') oldCount++;
      if (op.type !== 'del') newCount++;
    }
    const oldStart = oldCount === 0 ? oldLine - 1 : oldLine;
    const newStart = newCount === 0 ? newLine - 1 : newLine;
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, ...body);
    oldLine += oldCount;
    newLine += newCount;
    cursor = to + 1;
  }
  return `${out.join('\n')}\n`;
}
