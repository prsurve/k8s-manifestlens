#!/usr/bin/env node
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  RuleError,
  checkManifest,
  explainManifest,
  loadBundledRules,
  parseRules,
} from '../core/index.js';
import type { Rule, Severity } from '../core/index.js';
import { formatExplanation } from './format.js';
import { formatFindings } from './format-check.js';

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const USAGE = `Usage:
  manifestlens explain <file>
  manifestlens check <file> [--rules <file-or-dir>]... [--fail-on error|warning|info|none]

explain  Explain a Kubernetes manifest in plain English, line by line.
check    Flag risky or non-best-practice settings using the built-in rules.

Options:
  --rules <path>   Also load rules from a YAML file, or every .yaml file in a directory
                   (repeatable)
  --fail-on <lvl>  Exit 1 if there is a finding at this level or worse (default: error)
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
  if ((command !== 'explain' && command !== 'check') || !file || extra.length > 0) {
    io.stderr(USAGE);
    return 2;
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

function runCheck(
  file: string,
  source: string,
  rulePaths: string[],
  failOn: string | undefined,
  io: Io,
): number {
  if (failOn !== undefined && failOn !== 'none' && !LEVELS.includes(failOn as Severity)) {
    io.stderr(`--fail-on must be one of error, warning, info, none.\n`);
    return 2;
  }

  let rules: Rule[];
  try {
    rules = [...loadBundledRules(), ...rulePaths.flatMap(loadRuleFiles)];
  } catch (err) {
    io.stderr(`${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }
  const duplicate = rules.find((r, i) => rules.findIndex((o) => o.id === r.id) !== i);
  if (duplicate) {
    io.stderr(`Duplicate rule id "${duplicate.id}" (${duplicate.origin ?? 'unknown source'}).\n`);
    return 2;
  }

  const result = checkManifest(source, rules);
  if (result.documents.length === 0) {
    io.stderr(`${file}: no Kubernetes documents found.\n`);
    return 1;
  }
  io.stdout(`${formatFindings(result)}\n`);

  if (result.documents.some((d) => d.issues.length > 0)) return 1;
  const threshold = failOn ?? 'error';
  if (threshold === 'none') return 0;
  const min = LEVELS.indexOf(threshold as Severity);
  const failing = result.documents.some((d) =>
    d.findings.some((f) => LEVELS.indexOf(f.severity) >= min),
  );
  return failing ? 1 : 0;
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
