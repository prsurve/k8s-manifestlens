import type { ChangeType, Within } from './types.js';

/** A difference found by the walk, before lines and explanations are attached. */
export interface RawChange {
  type: ChangeType;
  path: string;
  before?: unknown;
  after?: unknown;
  within: Within[];
}

/** Fields the API server fills in; they are noise when comparing exported manifests. */
const SERVER_METADATA = [
  'uid',
  'resourceVersion',
  'creationTimestamp',
  'generation',
  'managedFields',
  'selfLink',
];

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** Drop `status` and server-set metadata so only what a person wrote is compared. */
export function stripServerFields(data: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...data };
  delete rest.status;
  if (!isObject(rest.metadata)) return rest;
  const metadata = Object.fromEntries(
    Object.entries(rest.metadata).filter(([k]) => !SERVER_METADATA.includes(k)),
  );
  return { ...rest, metadata };
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Compare two documents. Lists of objects that all have a unique `name` (containers, env vars,
 * volumes) are matched by name, so reordering is not a change. Other lists of objects are matched
 * by position; lists of plain values are compared as a whole.
 */
export function diffData(before: unknown, after: unknown): RawChange[] {
  const out: RawChange[] = [];
  walk(before, after, '', '', [], out);
  return out;
}

const join = (prefix: string, key: string): string => (prefix === '' ? key : `${prefix}.${key}`);

function walk(
  before: unknown,
  after: unknown,
  oldPath: string,
  newPath: string,
  within: Within[],
  out: RawChange[],
): void {
  if (isObject(before) && isObject(after)) {
    for (const key of Object.keys(after)) {
      if (!(key in before)) {
        out.push({ type: 'added', path: join(newPath, key), after: after[key], within });
      } else {
        walk(before[key], after[key], join(oldPath, key), join(newPath, key), within, out);
      }
    }
    for (const key of Object.keys(before)) {
      if (!(key in after)) {
        out.push({ type: 'removed', path: join(oldPath, key), before: before[key], within });
      }
    }
    return;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const key = lastKey(newPath);
    const oldNames = namesOf(before);
    const newNames = namesOf(after);
    if (oldNames && newNames) {
      after.forEach((item, i) => {
        const name = (item as { name: string }).name;
        const itemWithin = [...within, { list: key, name }];
        const j = oldNames.get(name);
        if (j === undefined) {
          out.push({ type: 'added', path: `${newPath}[${i}]`, after: item, within: itemWithin });
        } else {
          walk(before[j], item, `${oldPath}[${j}]`, `${newPath}[${i}]`, itemWithin, out);
        }
      });
      before.forEach((item, j) => {
        const name = (item as { name: string }).name;
        if (!newNames.has(name)) {
          out.push({
            type: 'removed',
            path: `${oldPath}[${j}]`,
            before: item,
            within: [...within, { list: key, name }],
          });
        }
      });
      return;
    }
    if (before.every(isObject) && after.every(isObject)) {
      for (let i = 0; i < Math.max(before.length, after.length); i++) {
        if (i >= before.length) {
          out.push({ type: 'added', path: `${newPath}[${i}]`, after: after[i], within });
        } else if (i >= after.length) {
          out.push({ type: 'removed', path: `${oldPath}[${i}]`, before: before[i], within });
        } else {
          walk(before[i], after[i], `${oldPath}[${i}]`, `${newPath}[${i}]`, within, out);
        }
      }
      return;
    }
  }

  if (!same(before, after)) {
    out.push({ type: 'changed', path: newPath, before, after, within });
  }
}

/** Name -> index, when every item is an object with a distinct string `name`. */
function namesOf(list: unknown[]): Map<string, number> | undefined {
  const names = new Map<string, number>();
  for (const [i, item] of list.entries()) {
    if (!isObject(item) || typeof item.name !== 'string' || names.has(item.name)) return undefined;
    names.set(item.name, i);
  }
  return list.length > 0 ? names : undefined;
}

function lastKey(path: string): string {
  const m = /([^.[\]]+)(\[\d+\])*$/.exec(path);
  return m?.[1] ?? '';
}
