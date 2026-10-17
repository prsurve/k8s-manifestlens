#!/usr/bin/env node
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  RuleError,
  checkManifest,
  diffManifests,
  explainManifest,
  loadBundledRules,
  parseRules,
} from '../core/index.js';
import type { Rule, Severity } from '../core/index.js';
import { formatExplanation } from './format.js';
import { formatDiff } from './format-diff.js';
import { formatFindings } from './format-check.js';

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const USAGE = `Usage:
  manifestlens explain <file>
  manifestlens check <file> [--rules <file-or-dir>]... [--fail-on error|warning|info|none]
  manifestlens diff <old-file> <new-file> [--rules <file-or-dir>]... [--fail-on ...]

explain  Explain a Kubernetes manifest in plain English, line by line.
check    Flag risky or non-best-practice settings using the built-in rules.
diff     Explain what applying <new-file> instead of <old-file> will do to the cluster,
         and which findings the change adds or removes.

Options:
  --rules <path>   Also load rules from a YAML file, or every .yaml file in a directory
                   (repeatable)
  --fail-on <lvl>  Exit 1 if there is a (new) finding at this level or worse (default: error)
  -h, --help       Show this help

Exit codes: 0 ok, 1 findings or YAML problems, 2 bad usage or unreadable file.
`;

const LEVELS = ['info', 'warning', 'error'] as const;

/** Run the CLI. Returns the process exit code instead of exiting, so tests can call it directly. */
export function run(argv: string[], io: Io): number {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        rules: { type: 'string', multiple: true },
        'fail-on': { type: 'string' },
      },
    });
  } catch (err) {
    io.stderr(`${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`);
    return 2;
  }

  const [command, file, ...extra] = parsed.positionals;
  if (parsed.values.help) {
    io.stdout(USAGE);
    return 0;
  }
  const fileCount = command === 'diff' ? 2 : 1;
  if (
    (command !== 'explain' && command !== 'check' && command !== 'diff') ||
    !file ||
    extra.length !== fileCount - 1
  ) {
    io.stderr(USAGE);
    return 2;
  }
  if (command === 'diff') {
    return runDiff(
      file,
      extra[0] as string,
      parsed.values.rules ?? [],
      parsed.values['fail-on'],
      io,
    );
  }

  let source: string;
  try {
    source = readFileSync(file, 'utf8');
  } catch (err) {
    io.stderr(`Cannot read ${file}: ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }

  if (command === 'explain') return runExplain(file, source, io);
  return runCheck(file, source, parsed.values.rules ?? [], parsed.values['fail-on'], io);
}

function runExplain(file: string, source: string, io: Io): number {
  const result = explainManifest(source);
  if (result.documents.length === 0) {
    io.stderr(`${file}: no Kubernetes documents found.\n`);
    return 1;
  }
  io.stdout(`${formatExplanation(result, source)}\n`);
  return result.documents.some((d) => d.issues.length > 0) ? 1 : 0;
}

/** Load bundled plus extra rules, or explain to the user why that failed. */
function loadAllRules(rulePaths: string[], io: Io): Rule[] | undefined {
  let rules: Rule[];
  try {
    rules = [...loadBundledRules(), ...rulePaths.flatMap(loadRuleFiles)];
  } catch (err) {
    io.stderr(`${err instanceof Error ? err.message : String(err)}\n`);
    return undefined;
  }
  const duplicate = rules.find((r, i) => rules.findIndex((o) => o.id === r.id) !== i);
  if (duplicate) {
    io.stderr(`Duplicate rule id "${duplicate.id}" (${duplicate.origin ?? 'unknown source'}).\n`);
    return undefined;
  }
  return rules;
}

function validFailOn(failOn: string | undefined, io: Io): boolean {
  if (failOn !== undefined && failOn !== 'none' && !LEVELS.includes(failOn as Severity)) {
    io.stderr(`--fail-on must be one of error, warning, info, none.\n`);
    return false;
  }
  return true;
}

/** True when a finding is at or above the --fail-on level (default: error). */
function failsThreshold(findings: { severity: Severity }[], failOn: string | undefined): boolean {
  const threshold = failOn ?? 'error';
  if (threshold === 'none') return false;
  const min = LEVELS.indexOf(threshold as Severity);
  return findings.some((f) => LEVELS.indexOf(f.severity) >= min);
}

function runDiff(
  oldFile: string,
  newFile: string,
  rulePaths: string[],
  failOn: string | undefined,
  io: Io,
): number {
  if (!validFailOn(failOn, io)) return 2;
  const sources: string[] = [];
  for (const file of [oldFile, newFile]) {
    try {
      sources.push(readFileSync(file, 'utf8'));
    } catch (err) {
      io.stderr(`Cannot read ${file}: ${err instanceof Error ? err.message : String(err)}\n`);
      return 2;
    }
  }
  const rules = loadAllRules(rulePaths, io);
  if (!rules) return 2;

  const result = diffManifests(sources[0] as string, sources[1] as string, rules);
  if (result.documents.length === 0 && result.issues.length === 0) {
    io.stderr('No Kubernetes documents found in either file.\n');
    return 1;
  }
  io.stdout(`${formatDiff(result)}\n`);
  if (result.issues.length > 0) return 1;
  return failsThreshold(
    result.documents.flatMap((d) => d.newFindings),
    failOn,
  )
    ? 1
    : 0;
}

function runCheck(
  file: string,
  source: string,
  rulePaths: string[],
  failOn: string | undefined,
  io: Io,
): number {
  if (!validFailOn(failOn, io)) return 2;
  const rules = loadAllRules(rulePaths, io);
  if (!rules) return 2;

  const result = checkManifest(source, rules);
  if (result.documents.length === 0) {
    io.stderr(`${file}: no Kubernetes documents found.\n`);
    return 1;
  }
  io.stdout(`${formatFindings(result)}\n`);

  if (result.documents.some((d) => d.issues.length > 0)) return 1;
  return failsThreshold(
    result.documents.flatMap((d) => d.findings),
    failOn,
  )
    ? 1
    : 0;
}

/** Load rules from a YAML file, or from every .yaml/.yml file in a directory. */
function loadRuleFiles(path: string): Rule[] {
  let files: string[];
  try {
    files = statSync(path).isDirectory()
      ? readdirSync(path)
          .filter((f) => /\.ya?ml$/.test(f))
          .sort()
          .map((f) => join(path, f))
      : [path];
  } catch (err) {
    throw new RuleError(
      `Cannot read rules at ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return files.flatMap((f) => parseRules(readFileSync(f, 'utf8'), f));
}

function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  process.exitCode = run(process.argv.slice(2), {
    stdout: (t) => process.stdout.write(t),
    stderr: (t) => process.stderr.write(t),
  });
}
