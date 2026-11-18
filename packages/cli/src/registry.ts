import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { RuleError, parseKindBundle } from '@k8s-manifestlens/core';
import type { KindStorage, StoredKindSet } from '@k8s-manifestlens/core';

const FORMAT = 'k8s-manifestlens-kinds';

/** Where the registry lives: `--registry`, then K8S_MANIFESTLENS_REGISTRY, then the user config folder. */
export function registryPath(
  flag: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  if (flag) return flag;
  if (env.K8S_MANIFESTLENS_REGISTRY) return env.K8S_MANIFESTLENS_REGISTRY;
  const config = env.XDG_CONFIG_HOME || join(home, '.config');
  return join(config, 'k8s-manifestlens', 'kinds.json');
}

/** Read the sets in a registry file synchronously. A missing file is an empty registry. */
export function readRegistry(path: string): StoredKindSet[] {
  if (!existsSync(path)) return [];
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new RuleError(
      `Cannot read the kind registry ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  // A malformed entry is ignored here; `kinds list` and `kinds import` report problems.
  return parseKindBundle(text, path).sets;
}

/**
 * The registry as a JSON file, in the same format `kinds export` writes, so a registry can be
 * committed, shared or restored as it is. Writes go to a temporary file first, then replace it.
 */
export class FileKindStorage implements KindStorage {
  constructor(readonly path: string) {}

  list(): Promise<StoredKindSet[]> {
    return Promise.resolve(readRegistry(this.path));
  }

  put(set: StoredKindSet): Promise<void> {
    const sets = readRegistry(this.path).filter((s) => s.id !== set.id);
    this.write([...sets, set]);
    return Promise.resolve();
  }

  remove(id: string): Promise<void> {
    this.write(readRegistry(this.path).filter((s) => s.id !== id));
    return Promise.resolve();
  }

  private write(sets: StoredKindSet[]): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ format: FORMAT, version: 1, sets }, null, 2)}\n`);
    chmodSync(tmp, 0o600);
    renameSync(tmp, this.path);
  }
}
