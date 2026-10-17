import { locate } from '../fields/locate.js';
import type { FieldChange } from './types.js';

/** Render a value for a sentence. */
export function show(value: unknown): string {
  if (value === undefined) return '(not set)';
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return value.every((v) => v === null || typeof v !== 'object')
      ? `[${value.map(String).join(', ')}]`
      : `a list of ${value.length}`;
  }
  if (typeof value === 'object') return `{${Object.keys(value).length} fields}`;
  return String(value);
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

const REJECTED =
  'Kubernetes will reject this: most fields of a running Pod cannot be changed. Delete and recreate the Pod to apply it.';

/** Fields of a running Pod that Kubernetes allows to change in place. */
function podAllows(pattern: string): boolean {
  return (
    /^spec\.(containers|initContainers)\[\]\.image$/.test(pattern) ||
    pattern === 'spec.activeDeadlineSeconds' ||
    pattern.startsWith('spec.tolerations') ||
    pattern.startsWith('metadata.')
  );
}

interface Ctx {
  kind: string;
  /** Description of the container the field belongs to, e.g. `container "web"`. */
  c: string;
  rel: string;
  level: 'object' | 'pod' | 'container';
  /** Name of the innermost named list item, e.g. an env var or volume. */
  item?: string;
}

/** Describe in plain English what one change will do. Returns undefined when we have nothing useful to add. */
export function describeEffect(kind: string, change: FieldChange): string | undefined {
  const where = locate(kind, change.pattern);
  const container = change.within.find(
    (w) => w.list === 'containers' || w.list === 'initContainers',
  );
  const item = change.within.at(-1);
  const ctx: Ctx = {
    kind,
    c: container ? `container "${container.name}"` : 'the container',
    rel: where.rel,
    level: where.level,
    ...(item ? { item: item.name } : {}),
  };

  const specific = byKind(kind, change, ctx);
  if (kind === 'Pod' && where.level !== 'object' && !podAllows(change.pattern)) {
    return specific ? `${specific} ${REJECTED}` : REJECTED;
  }
  return specific;
}

function byKind(kind: string, change: FieldChange, ctx: Ctx): string | undefined {
  const generic = metadataEffect(change, ctx);
  if (generic) return generic;
  if (ctx.level === 'container') return containerEffect(change, ctx);
  if (ctx.level === 'pod') return podEffect(change, ctx);
  if (kind === 'Deployment') return deploymentEffect(change, ctx);
  if ((kind === 'StatefulSet' || kind === 'ReplicaSet') && ctx.rel === 'spec.replicas') {
    return scaleEffect(change);
  }
  if (ctx.rel.startsWith('spec.template.metadata.labels') && kind !== 'Pod') {
    return 'Changes the labels of new Pods. They must still match spec.selector, or Kubernetes rejects the change.';
  }
  if (kind === 'Service') return serviceEffect(change, ctx);
  return undefined;
}

// ---------------------------------------------------------------------------------------------

function metadataEffect(change: FieldChange, ctx: Ctx): string | undefined {
  const { rel } = ctx;
  if (ctx.level !== 'object') return undefined;
  if (rel.startsWith('metadata.labels')) {
    return 'Labels on the object itself. Anything that selects objects by label (a Service, a NetworkPolicy, kubectl get -l) may start or stop matching it.';
  }
  if (rel.startsWith('metadata.annotations')) {
    return 'Annotations do not change how Kubernetes runs the object, but tools that read this annotation may react.';
  }
  if (rel === 'apiVersion') {
    return `The same object is described with a different API version (${show(change.before)} to ${show(change.after)}). Check that the new version still supports every field you use.`;
  }
  return undefined;
}

/** Effect of changing `spec.replicas` on a Deployment, StatefulSet or ReplicaSet. */
function scaleEffect(change: FieldChange): string | undefined {
  const before = typeof change.before === 'number' ? change.before : 1;
  const after = typeof change.after === 'number' ? change.after : 1;
  if (after === before) return undefined;
  if (after === 0) return 'Scales to zero: all Pods stop and the application is unavailable.';
  const diff = Math.abs(after - before);
  return after > before
    ? `Scales up from ${before} to ${after}: ${plural(diff, 'more Pod')} will be started. Running Pods keep running.`
    : `Scales down from ${before} to ${after}: ${plural(diff, 'Pod')} will be stopped. The rest keep running.`;
}

function deploymentEffect(change: FieldChange, ctx: Ctx): string | undefined {
  const { rel } = ctx;
  if (rel === 'spec.replicas') return scaleEffect(change);
  if (rel.startsWith('spec.selector')) {
    return 'Kubernetes does not allow changing the selector of an existing Deployment. Applying this will be rejected; delete and recreate the Deployment instead.';
  }
  if (rel.startsWith('spec.strategy')) {
    return 'Only changes how future updates are rolled out. Running Pods are not touched.';
  }
  if (rel === 'spec.paused') {
    return change.after === true
      ? 'Rollouts are paused: later changes to the Pod template will not take effect until the Deployment is resumed.'
      : 'Rollouts resume: any pending change to the Pod template is rolled out now.';
  }
  if (rel === 'spec.revisionHistoryLimit') {
    return 'Changes how many old ReplicaSets are kept for rollbacks. Running Pods are not touched.';
  }
  if (rel === 'spec.minReadySeconds' || rel === 'spec.progressDeadlineSeconds') {
    return 'Changes how long Kubernetes waits during a rollout. Running Pods are not touched.';
  }
  if (rel.startsWith('spec.template.metadata.labels')) {
    return 'Changes the labels of new Pods and starts a rollout. They must still match spec.selector, or Kubernetes rejects the Deployment.';
  }
  if (rel.startsWith('spec.template.metadata.annotations')) {
    return 'Changes the annotations of new Pods. Any change to the Pod template starts a rollout.';
  }
  return undefined;
}

function serviceEffect(change: FieldChange, ctx: Ctx): string | undefined {
  const { rel } = ctx;
  if (rel === 'spec.type') {
    const to = show(change.after ?? 'ClusterIP');
    const from = show(change.before ?? 'ClusterIP');
    const what: Record<string, string> = {
      ClusterIP: 'It becomes reachable only from inside the cluster.',
      NodePort: 'It also opens a port on every node of the cluster.',
      LoadBalancer:
        'The cloud provider will create an external load balancer, which usually costs money and may be reachable from the internet.',
      ExternalName: 'It becomes a DNS alias for an external name and stops routing to Pods.',
    };
    return `The Service changes from ${from} to ${to}. ${what[to] ?? ''}`.trim();
  }
  if (rel.startsWith('spec.selector')) {
    return 'Traffic will go to a different set of Pods. If no Pod has these labels, the Service has no endpoints and requests fail.';
  }
  if (rel === 'spec.clusterIP') {
    return 'Kubernetes does not allow changing the cluster IP of an existing Service. Applying this will be rejected.';
  }
  if (rel === 'spec.ports[].port') {
    return `Clients must now connect on port ${show(change.after)}. The old port ${show(change.before)} stops working.`;
  }
  if (rel === 'spec.ports[].targetPort') {
    return `Traffic is now sent to port ${show(change.after)} on the Pods. Make sure the application listens there.`;
  }
  if (rel === 'spec.ports[].nodePort') {
    return `The port opened on every node changes to ${show(change.after)}. Anything using the old node port stops working.`;
  }
  if (rel === 'spec.ports[]') {
    return change.type === 'added'
      ? 'The Service starts listening on an additional port.'
      : 'The Service stops listening on this port. Clients using it will fail.';
  }
  if (rel === 'spec.loadBalancerSourceRanges') {
    return 'Changes which IP ranges may reach the load balancer.';
  }
  if (rel === 'spec.sessionAffinity') {
    return 'Changes whether repeated requests from one client go to the same Pod.';
  }
  return undefined;
}

function podEffect(change: FieldChange, ctx: Ctx): string | undefined {
  const { rel } = ctx;
  if (rel === 'containers[]' || rel === 'initContainers[]') {
    const name = ctx.item ?? 'a container';
    const init = rel.startsWith('init');
    if (change.type === 'added') {
      return init
        ? `Adds init container "${name}", which must finish before the main containers start.`
        : `Adds container "${name}" to every Pod.`;
    }
    return `Removes ${init ? 'init ' : ''}container "${name}" from every Pod.`;
  }
  if (rel.startsWith('volumes')) {
    return `Changes the storage available to the Pod's containers.`;
  }
  if (
    rel.startsWith('nodeSelector') ||
    rel.startsWith('affinity') ||
    rel.startsWith('tolerations')
  ) {
    return `Changes which nodes the Pod may run on. A Pod that fits no node stays Pending.`;
  }
  if (rel === 'serviceAccountName') {
    return `The Pod runs as a different ServiceAccount (${show(change.before)} to ${show(change.after)}), so its permissions on the Kubernetes API change.`;
  }
  if (/^host(Network|PID|IPC)$/.test(rel)) {
    return change.after === true
      ? `The Pod now shares the node's ${rel.slice(4)} namespace, which weakens isolation.`
      : `The Pod stops sharing the node's ${rel.slice(4)} namespace.`;
  }
  if (rel.startsWith('securityContext')) {
    return `Changes security settings for every container in the Pod.`;
  }
  if (rel === 'terminationGracePeriodSeconds') {
    return `Changes how long containers get to shut down cleanly before being killed.`;
  }
  if (rel === 'restartPolicy') {
    return `Changes whether and when exited containers are restarted.`;
  }
  return undefined;
}

function containerEffect(change: FieldChange, ctx: Ctx): string | undefined {
  const { rel, c } = ctx;
  // Controllers announce the rollout once per object (see notesFor), so only a bare Pod says it here.
  const restart = ctx.kind === 'Pod' ? ' The container restarts.' : '';
  const name = ctx.item ?? '';

  if (rel === 'image') {
    const after = show(change.after);
    const unpinned = !/@/.test(after) && (!/:[^/]+$/.test(after) || after.endsWith(':latest'));
    const warn = unpinned
      ? ' Warning: this image has no fixed version, so it can change without any change to the manifest.'
      : '';
    if (change.type === 'changed') {
      return `${cap(c)} will run ${after} instead of ${show(change.before)}.${restart}${warn}`;
    }
    return `${cap(c)} will run ${after}.${restart}${warn}`;
  }
  if (rel.startsWith('resources.requests')) {
    const what = rel.endsWith('.cpu') ? 'CPU' : rel.endsWith('.memory') ? 'memory' : 'resources';
    return `The scheduler reserves ${show(change.after)} of ${what} for ${c} (was ${show(change.before)}). New Pods need a node with that much free, or they stay Pending.`;
  }
  if (rel === 'resources.limits.memory') {
    return change.type === 'removed'
      ? `${cap(c)} no longer has a memory cap and can use all the memory on its node.`
      : `${cap(c)} may use at most ${show(change.after)} of memory (was ${show(change.before)}). Above that it is killed (OOMKilled) and restarted.`;
  }
  if (rel === 'resources.limits.cpu') {
    return change.type === 'removed'
      ? `${cap(c)} is no longer slowed down when it uses a lot of CPU.`
      : `${cap(c)} is slowed down (throttled) above ${show(change.after)} of CPU (was ${show(change.before)}).`;
  }
  if (rel.startsWith('resources')) {
    return `Changes the CPU and memory reserved for or allowed to ${c}.${restart}`;
  }
  if (rel === 'env[]') {
    return change.type === 'added'
      ? `Adds environment variable ${name} to ${c}.${restart}`
      : `Removes environment variable ${name} from ${c}.${restart}`;
  }
  if (rel.startsWith('env[]')) {
    return `Environment variable ${name} in ${c} changes from ${show(change.before)} to ${show(change.after)}. Applications read these when they start.${restart}`;
  }
  if (rel === 'command' || rel === 'args') {
    return `Changes the program or arguments that start ${c}.${restart}`;
  }
  const probe = /^(liveness|readiness|startup)Probe/.exec(rel);
  if (probe) {
    const meaning: Record<string, string> = {
      liveness: 'a failing check restarts the container',
      readiness: 'a failing check removes the Pod from Service traffic',
      startup: 'other checks wait until it passes',
    };
    const [, kind] = probe as unknown as [string, string];
    if (rel === `${kind}Probe` && change.type === 'added') {
      return `Kubernetes starts running a ${kind} check on ${c}: ${meaning[kind]}.${restart}`;
    }
    if (rel === `${kind}Probe` && change.type === 'removed') {
      return `Kubernetes stops running the ${kind} check on ${c}.${restart}`;
    }
    return `Changes the ${kind} check on ${c} (${meaning[kind]}).${restart}`;
  }
  if (rel === 'securityContext.privileged') {
    return change.after === true
      ? `${cap(c)} becomes privileged: it gets almost the same access as a process on the node.${restart}`
      : `${cap(c)} is no longer privileged.${restart}`;
  }
  if (rel === 'securityContext.runAsNonRoot') {
    return change.after === true
      ? `Kubernetes will refuse to start ${c} if it would run as root.${restart}`
      : `${cap(c)} is no longer prevented from running as root.${restart}`;
  }
  if (rel === 'securityContext.readOnlyRootFilesystem') {
    return change.after === true
      ? `${cap(c)} can no longer write to its own filesystem. Make sure it only writes to mounted volumes.${restart}`
      : `${cap(c)} can write to its own filesystem again.${restart}`;
  }
  if (rel.startsWith('securityContext')) {
    return `Changes the security settings of ${c}.${restart}`;
  }
  if (rel === 'ports[]' || rel.startsWith('ports[]')) {
    return 'Declared container ports are documentation: they do not open or block anything. A Service that refers to a port by name is affected.';
  }
  if (rel.startsWith('volumeMounts')) {
    return `Changes where storage appears inside ${c}.${restart}`;
  }
  return undefined;
}

function cap(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
