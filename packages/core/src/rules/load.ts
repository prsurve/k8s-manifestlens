import { isMap, parseAllDocuments } from 'yaml';
import type { Condition, FixRisk, FixSet, FixSpec, Rule, RuleScope, Severity } from './types.js';

export class RuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuleError';
  }
}

const SEVERITIES: Severity[] = ['info', 'warning', 'error'];
const SCOPES: RuleScope[] = ['document', 'pod', 'container', 'initContainer'];
const RULE_KEYS = [
  'id',
  'title',
  'severity',
  'kinds',
  'scope',
  'when',
  'report',
  'message',
  'why',
  'fix',
  'autofix',
];

/**
 * Parse rules from YAML text. Each YAML document is one rule, so a file can hold many rules
 * separated by `---`. Throws a RuleError that names the file and rule when something is wrong.
 */
export function parseRules(text: string, origin = 'rules'): Rule[] {
  const rules: Rule[] = [];
  for (const doc of parseAllDocuments(text)) {
    if (doc.errors.length > 0) {
      throw new RuleError(`${origin}: ${doc.errors[0]?.message.split('\n')[0] ?? 'invalid YAML'}`);
    }
    if (doc.contents === null) continue;
    if (!isMap(doc.contents)) {
      throw new RuleError(`${origin}: each rule must be a mapping.`);
    }
    const data: unknown = doc.toJS();
    if (data === null || data === undefined) continue;
    rules.push(toRule(data as Record<string, unknown>, origin, rules.length + 1));
  }
  return rules;
}

function toRule(raw: Record<string, unknown>, origin: string, position: number): Rule {
  const label =
    typeof raw.id === 'string' ? `${origin}: rule "${raw.id}"` : `${origin}: rule #${position}`;
  const fail = (msg: string): never => {
    throw new RuleError(`${label}: ${msg}`);
  };

  for (const key of Object.keys(raw)) {
    if (!RULE_KEYS.includes(key)) fail(`unknown key "${key}".`);
  }
  const id = requiredString(raw, 'id', fail);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) fail('"id" must be lowercase words joined by dashes.');
  const title = requiredString(raw, 'title', fail);
  const message = requiredString(raw, 'message', fail);

  const severity = raw.severity;
  if (!SEVERITIES.includes(severity as Severity)) {
    fail(`"severity" must be one of ${SEVERITIES.join(', ')}.`);
  }

  const kinds = stringList(raw.kinds);
  if (!kinds || kinds.length === 0) fail('"kinds" must be a non-empty list of strings.');

  const scopeRaw = raw.scope === undefined ? ['document'] : stringList(raw.scope);
  if (
    !scopeRaw ||
    scopeRaw.length === 0 ||
    scopeRaw.some((s) => !SCOPES.includes(s as RuleScope))
  ) {
    fail(`"scope" must be one or a list of ${SCOPES.join(', ')}.`);
  }

  const reportRaw = raw.report === undefined ? [] : stringList(raw.report);
  if (!reportRaw) fail('"report" must be a path or a list of paths.');

  if (raw.when === undefined) fail('"when" is required.');
  const when = toCondition(raw.when, fail);

  const rule: Rule = {
    id,
    title,
    severity: severity as Severity,
    kinds: kinds as string[],
    scopes: scopeRaw as RuleScope[],
    when,
    report: reportRaw as string[],
    message,
    origin,
  };
  for (const key of ['why', 'fix'] as const) {
    const value = raw[key];
    if (value === undefined) continue;
    if (typeof value !== 'string') fail(`"${key}" must be a string.`);
    rule[key] = (value as string).trim();
  }
  if (raw.autofix !== undefined) rule.autofix = toFixSpec(raw.autofix, fail);
  return rule;
}

const FIX_RISKS: FixRisk[] = ['low', 'medium', 'high'];
const FIX_KEYS = ['risk', 'summary', 'requires', 'set'];
const FIX_PATH = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/;

function toFixSpec(raw: unknown, fail: (msg: string) => never): FixSpec {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return fail('"autofix" must be a mapping.');
  }
  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!FIX_KEYS.includes(key)) fail(`unknown key "${key}" in "autofix".`);
  }
  if (!FIX_RISKS.includes(obj.risk as FixRisk)) {
    fail(`"autofix.risk" must be one of ${FIX_RISKS.join(', ')}.`);
  }
  if (typeof obj.summary !== 'string' || obj.summary.trim() === '') {
    fail('"autofix.summary" is required.');
  }
  const summary = (obj.summary as string).trim();
  const set = obj.set;
  if (
    set === null ||
    typeof set !== 'object' ||
    Array.isArray(set) ||
    Object.keys(set).length === 0
  ) {
    return fail('"autofix.set" must be a non-empty mapping of path to value.');
  }
  const sets: FixSet[] = Object.entries(set).map(([path, value]): FixSet => {
    if (!FIX_PATH.test(path)) {
      return fail(`"autofix.set" path "${path}" must be plain dotted keys, with no [] or $pod.`);
    }
    const isParam =
      value !== null && typeof value === 'object' && !Array.isArray(value) && '$param' in value;
    if (!isParam) return { path, value };
    const { $param: name, pattern, ...extra } = value as Record<string, unknown>;
    if (
      Object.keys(extra).length > 0 ||
      typeof name !== 'string' ||
      !/^\w+$/.test(name) ||
      (pattern !== undefined && typeof pattern !== 'string')
    ) {
      return fail(
        `"autofix.set" value for "${path}" must be { $param: name } with an optional "pattern".`,
      );
    }
    if (pattern === undefined) return { path, param: name };
    try {
      return { path, param: name, pattern: new RegExp(pattern as string) };
    } catch {
      return fail(`invalid regular expression "${pattern as string}" for "${path}".`);
    }
  });
  const paths = sets.map((s) => s.path);
  for (const a of paths) {
    if (paths.some((b) => b !== a && b.startsWith(`${a}.`))) {
      fail(`"autofix.set" paths "${a}" and a path below it cannot both be set.`);
    }
  }
  return {
    risk: obj.risk as FixRisk,
    summary,
    ...(obj.requires !== undefined ? { requires: toCondition(obj.requires, fail) } : {}),
    set: sets,
  };
}

function requiredString(
  raw: Record<string, unknown>,
  key: string,
  fail: (msg: string) => never,
): string {
  const value = raw[key];
  if (typeof value !== 'string' || value.trim() === '') fail(`"${key}" is required.`);
  return (value as string).trim();
}

function stringList(value: unknown): string[] | undefined {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return value as string[];
  return undefined;
}

function toCondition(raw: unknown, fail: (msg: string) => never): Condition {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return fail('a condition must be a mapping such as { missing: some.path }.');
  }
  const entries = Object.entries(raw);
  if (entries.length !== 1) return fail('a condition must have exactly one operator.');
  const [op, arg] = entries[0] as [string, unknown];

  switch (op) {
    case 'missing':
    case 'present':
      if (typeof arg !== 'string') return fail(`"${op}" takes a path.`);
      return { op, path: arg };
    case 'equals':
    case 'contains':
    case 'matches':
    case 'in': {
      const [path, value] = singleEntry(op, arg, fail);
      if (op === 'matches') {
        if (typeof value !== 'string') return fail('"matches" takes a regular expression string.');
        try {
          return { op, path, pattern: new RegExp(value) };
        } catch {
          return fail(`invalid regular expression "${value}".`);
        }
      }
      if (op === 'in') {
        if (!Array.isArray(value)) return fail('"in" takes a list of values.');
        return { op, path, values: value };
      }
      return { op, path, value };
    }
    case 'all':
    case 'any':
      if (!Array.isArray(arg) || arg.length === 0) return fail(`"${op}" takes a non-empty list.`);
      return { op, conditions: arg.map((c) => toCondition(c, fail)) };
    case 'not':
      return { op: 'not', condition: toCondition(arg, fail) };
    default:
      return fail(`unknown operator "${op}".`);
  }
}

function singleEntry(op: string, arg: unknown, fail: (msg: string) => never): [string, unknown] {
  if (arg === null || typeof arg !== 'object' || Array.isArray(arg)) {
    return fail(`"${op}" takes a single { path: value } pair.`);
  }
  const entries = Object.entries(arg);
  if (entries.length !== 1) return fail(`"${op}" takes exactly one { path: value } pair.`);
  return entries[0] as [string, unknown];
}
