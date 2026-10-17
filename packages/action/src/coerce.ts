/** Collects every problem found while reading settings, so the user sees them all at once. */
export class Problems {
  readonly items: string[] = [];
  add(message: string): void {
    this.items.push(message);
  }
  get any(): boolean {
    return this.items.length > 0;
  }
}

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(
      problems.length === 1 ? (problems[0] as string) : `${problems.length} configuration problems`,
    );
    this.name = 'ConfigError';
  }
}

export function asEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  name: string,
  p: Problems,
): T | undefined {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : value;
  if (typeof text === 'string' && (allowed as readonly string[]).includes(text)) return text as T;
  p.add(`${name}: "${String(value)}" is not valid. Use one of: ${allowed.join(', ')}.`);
  return undefined;
}

export function asInt(
  value: unknown,
  name: string,
  p: Problems,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
): number | undefined {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : NaN;
  if (!Number.isInteger(n) || n < min || n > max) {
    p.add(
      `${name}: "${String(value)}" must be a whole number from ${min}${max === Number.MAX_SAFE_INTEGER ? ' up' : ` to ${max}`}.`,
    );
    return undefined;
  }
  return n;
}

export function asBool(value: unknown, name: string, p: Problems): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const t = value.trim().toLowerCase();
    if (t === 'true') return true;
    if (t === 'false') return false;
  }
  p.add(`${name}: "${String(value)}" must be true or false.`);
  return undefined;
}

export function asString(value: unknown, name: string, p: Problems): string | undefined {
  if (typeof value === 'string') return value.trim();
  p.add(`${name}: must be text.`);
  return undefined;
}

/** A list from a YAML array or from a text input. Text is split on newlines, and on commas if asked. */
export function asList(
  value: unknown,
  name: string,
  p: Problems,
  splitCommas: boolean,
): string[] | undefined {
  let items: unknown[];
  if (Array.isArray(value)) items = value;
  else if (typeof value === 'string') items = value.split(splitCommas ? /[\n,]/ : /\n/);
  else {
    p.add(`${name}: must be a list.`);
    return undefined;
  }
  const out: string[] = [];
  for (const item of items) {
    if (typeof item !== 'string') {
      p.add(`${name}: every entry must be text.`);
      return undefined;
    }
    const t = item.trim();
    if (t !== '') out.push(t);
  }
  return out;
}

/** Closest allowed word within a small edit distance, for "did you mean" hints. */
export function suggest(word: string, candidates: readonly string[]): string | undefined {
  let best: { name: string; d: number } | undefined;
  for (const name of candidates) {
    const d = distance(word, name);
    if (d <= 2 && (!best || d < best.d)) best = { name, d };
  }
  return best?.name;
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0] as number;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j] as number;
      row[j] = Math.min(
        (row[j] as number) + 1,
        (row[j - 1] as number) + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = tmp;
    }
  }
  return row[b.length] as number;
}
