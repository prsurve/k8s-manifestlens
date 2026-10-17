/** Where in a manifest a field pattern sits, so lookups can ignore the kind-specific nesting. */
export type Level = 'object' | 'pod' | 'container';

export interface Location {
  level: Level;
  /** Pattern relative to the level: the whole pattern, the Pod spec, or one container. */
  rel: string;
  /** True for containers in `initContainers`. */
  init?: boolean;
}

/** Where the Pod spec lives for each kind that has one. */
export const POD_SPEC_PATH: Record<string, string> = {
  Pod: 'spec',
  Deployment: 'spec.template.spec',
  StatefulSet: 'spec.template.spec',
  DaemonSet: 'spec.template.spec',
  ReplicaSet: 'spec.template.spec',
  Job: 'spec.template.spec',
  CronJob: 'spec.jobTemplate.spec.template.spec',
};

/** Work out whether a field pattern is on the object itself, its Pod spec, or a container. */
export function locate(kind: string | undefined, pattern: string): Location {
  const podPath =
    kind !== undefined && Object.hasOwn(POD_SPEC_PATH, kind) ? POD_SPEC_PATH[kind] : undefined;
  if (podPath === undefined || !pattern.startsWith(`${podPath}.`)) {
    return { level: 'object', rel: pattern };
  }
  const rel = pattern.slice(podPath.length + 1);
  const container = /^(containers|initContainers)\[\]\.(.+)$/.exec(rel);
  if (container) {
    return {
      level: 'container',
      rel: container[2] as string,
      ...(container[1] === 'initContainers' ? { init: true } : {}),
    };
  }
  return { level: 'pod', rel };
}
