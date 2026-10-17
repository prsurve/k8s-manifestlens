import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import * as glob from '@actions/glob';
import { looksLikeKubernetes } from '@manifestlens/core';
import { ConfigError } from './coerce.js';
import type { Settings } from './types.js';

export interface FoundFile {
  /** Path relative to the workspace, with forward slashes. */
  path: string;
  text: string;
}

export interface Discovery {
  files: FoundFile[];
  skipped: { path: string; reason: string }[];
  /** How many files the patterns matched before any were filtered out. */
  matched: number;
}

const ALWAYS_EXCLUDED = ['**/node_modules/**', '**/.git/**'];

/** Patterns made absolute under the working directory; `!` exclusions keep their `!`. */
export function buildPatterns(s: Settings, workspace: string): string {
  const root = join(workspace, s.workingDirectory);
  const abs = (p: string): string =>
    p.startsWith('!') ? `!${join(root, p.slice(1))}` : join(root, p);
  return [...s.paths.map(abs), ...ALWAYS_EXCLUDED.map((p) => `!${join(root, p)}`)].join('\n');
}

/** Find the Kubernetes manifests to check, within the safety limits in the settings. */
export async function discover(s: Settings, workspace: string): Promise<Discovery> {
  const root = realpathSync(workspace);
  const globber = await glob.create(buildPatterns(s, workspace), {
    followSymbolicLinks: false,
    matchDirectories: false,
  });
  const candidates = (await globber.glob()).sort();

  if (candidates.length > s.maxFiles) {
    throw new ConfigError([
      `paths matched ${candidates.length} files, more than max-files (${s.maxFiles}). Narrow "paths" or raise max-files.`,
    ]);
  }

  const files: FoundFile[] = [];
  const skipped: Discovery['skipped'] = [];
  for (const abs of candidates) {
    const path = relative(workspace, abs).split(sep).join('/');
    const info = lstatSync(abs);
    if (!info.isFile()) continue;
    if (info.isSymbolicLink()) {
      skipped.push({ path, reason: 'symbolic link' });
      continue;
    }
    const real = realpathSync(abs);
    if (real !== root && !real.startsWith(root + sep)) {
      skipped.push({ path, reason: 'outside the repository' });
      continue;
    }
    if (info.size > s.maxFileSizeKb * 1024) {
      skipped.push({ path, reason: `larger than max-file-size-kb (${s.maxFileSizeKb})` });
      continue;
    }
    const text = readFileSync(real, 'utf8');
    if (!looksLikeKubernetes(text)) continue;
    files.push({ path, text });
  }
  return { files, skipped, matched: candidates.length };
}
