#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { explainManifest } from '../core/index.js';
import { formatExplanation } from './format.js';

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const USAGE = `Usage: manifestlens explain <file>

Explain a Kubernetes manifest in plain English, line by line.

Options:
  -h, --help   Show this help

Exit codes: 0 ok, 1 the manifest has YAML problems, 2 bad usage or unreadable file.
`;

/** Run the CLI. Returns the process exit code instead of exiting, so tests can call it directly. */
export function run(argv: string[], io: Io): number {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { help: { type: 'boolean', short: 'h' } },
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
  if (command !== 'explain' || !file || extra.length > 0) {
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

  const result = explainManifest(source);
  if (result.documents.length === 0) {
    io.stderr(`${file}: no Kubernetes documents found.\n`);
    return 1;
  }
  io.stdout(`${formatExplanation(result, source)}\n`);
  return result.documents.some((d) => d.issues.length > 0) ? 1 : 0;
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
