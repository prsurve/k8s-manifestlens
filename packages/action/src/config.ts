import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { parse } from 'yaml';
import { Problems } from './coerce.js';
import { parseConfig } from './settings.js';
import type { Layer } from './types.js';

export interface LoadedConfig {
  layer: Layer;
  /** The file that was read, or null when there is none. */
  path: string | null;
}

const MAX_CONFIG_BYTES = 256 * 1024;

/**
 * Read the project-level config file. A missing file is fine when it is the default location and an
 * error when the workflow named it explicitly.
 */
export function loadConfig(
  workspace: string,
  file: string,
  explicit: boolean,
  p: Problems,
): LoadedConfig {
  const abs = join(workspace, file);
  if (!existsSync(abs)) {
    if (explicit) p.add(`config-file: "${file}" does not exist.`);
    return { layer: {}, path: null };
  }

  const real = realpathSync(abs);
  const root = realpathSync(workspace);
  if (real !== root && !real.startsWith(root + sep)) {
    p.add(`config-file: "${file}" points outside the repository.`);
    return { layer: {}, path: null };
  }
  if (!statSync(real).isFile()) {
    p.add(`config-file: "${file}" is not a file.`);
    return { layer: {}, path: null };
  }
  if (statSync(real).size > MAX_CONFIG_BYTES) {
    p.add(`config-file: "${file}" is larger than ${MAX_CONFIG_BYTES / 1024} KB.`);
    return { layer: {}, path: null };
  }

  let data: unknown;
  try {
    data = parse(readFileSync(real, 'utf8'));
  } catch (err) {
    p.add(
      `${file}: not valid YAML. ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`,
    );
    return { layer: {}, path: file };
  }
  return { layer: parseConfig(data, file, p), path: file };
}
