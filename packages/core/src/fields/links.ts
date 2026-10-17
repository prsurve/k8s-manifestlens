import { locate } from './locate.js';

const DOCS = 'https://kubernetes.io/docs';
const API = `${DOCS}/reference/kubernetes-api`;
const POD_API = `${API}/workload-resources/pod-v1`;

const concept = {
  objects: `${DOCS}/concepts/overview/working-with-objects/`,
  labels: `${DOCS}/concepts/overview/working-with-objects/labels/`,
  annotations: `${DOCS}/concepts/overview/working-with-objects/annotations/`,
  namespaces: `${DOCS}/concepts/overview/working-with-objects/namespaces/`,
  pods: `${DOCS}/concepts/workloads/pods/`,
  initContainers: `${DOCS}/concepts/workloads/pods/init-containers/`,
  podLifecycle: `${DOCS}/concepts/workloads/pods/pod-lifecycle/`,
  deployment: `${DOCS}/concepts/workloads/controllers/deployment/`,
  service: `${DOCS}/concepts/services-networking/service/`,
  dns: `${DOCS}/concepts/services-networking/dns-pod-service/`,
  images: `${DOCS}/concepts/containers/images/`,
  resources: `${DOCS}/concepts/configuration/manage-resources-containers/`,
  volumes: `${DOCS}/concepts/storage/volumes/`,
  scheduling: `${DOCS}/concepts/scheduling-eviction/assign-pod-node/`,
  taints: `${DOCS}/concepts/scheduling-eviction/taint-and-toleration/`,
  podSecurity: `${DOCS}/concepts/security/pod-security-standards/`,
  probes: `${DOCS}/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/`,
  securityContext: `${DOCS}/tasks/configure-pod-container/security-context/`,
  env: `${DOCS}/tasks/inject-data-application/define-environment-variable-container/`,
  serviceAccount: `${DOCS}/tasks/configure-pod-container/configure-service-account/`,
  pullSecrets: `${DOCS}/tasks/configure-pod-container/pull-image-private-registry/`,
};

/** `[field-name prefix, url]` pairs; the first entry whose prefix matches wins. */
type Table = [prefix: string, url: string][];

const containerLinks: Table = [
  ['image', concept.images],
  ['resources', concept.resources],
  ['livenessProbe', concept.probes],
  ['readinessProbe', concept.probes],
  ['startupProbe', concept.probes],
  ['securityContext', concept.securityContext],
  ['env', concept.env],
  ['ports', `${POD_API}/#ContainerPort`],
  ['volumeMounts', concept.volumes],
  ['lifecycle', `${POD_API}/#Lifecycle`],
];

const podLinks: Table = [
  ['initContainers', concept.initContainers],
  ['containers', concept.pods],
  ['volumes', concept.volumes],
  ['serviceAccountName', concept.serviceAccount],
  ['automountServiceAccountToken', concept.serviceAccount],
  ['nodeSelector', concept.scheduling],
  ['affinity', concept.scheduling],
  ['tolerations', concept.taints],
  ['securityContext', concept.securityContext],
  ['restartPolicy', concept.podLifecycle],
  ['terminationGracePeriodSeconds', concept.podLifecycle],
  ['host', concept.podSecurity],
  ['dnsPolicy', concept.dns],
  ['imagePullSecrets', concept.pullSecrets],
];

const metaLinks: Table = [
  ['apiVersion', concept.objects],
  ['kind', concept.objects],
  ['metadata.labels', concept.labels],
  ['metadata.annotations', concept.annotations],
  ['metadata.namespace', concept.namespaces],
  ['metadata', `${API}/common-definitions/object-meta/#ObjectMeta`],
];

/** Controllers that run Pods from a template share these links. */
const workloadLinks = (page: string): Table => [
  ...metaLinks,
  ['spec.template.metadata.labels', concept.labels],
  ['spec.template.metadata.annotations', concept.annotations],
  ['spec.selector', concept.labels],
  ['spec', page],
];

/** Per-kind links for fields that are not part of a Pod spec. Kinds without an entry use `metaLinks`. */
const objectLinks: Record<string, Table> = {
  Deployment: workloadLinks(concept.deployment),
  StatefulSet: workloadLinks(`${DOCS}/concepts/workloads/controllers/statefulset/`),
  DaemonSet: workloadLinks(`${DOCS}/concepts/workloads/controllers/daemonset/`),
  ReplicaSet: workloadLinks(`${DOCS}/concepts/workloads/controllers/replicaset/`),
  Service: [
    ...metaLinks,
    ['spec.selector', concept.labels],
    ['spec.ports', `${API}/service-resources/service-v1/#ServicePort`],
    ['spec', concept.service],
  ],
};

/** The page to fall back on when no more specific link matches. */
const kindPage: Record<string, string> = {
  Pod: concept.pods,
  Deployment: concept.deployment,
  Service: concept.service,
  StatefulSet: `${DOCS}/concepts/workloads/controllers/statefulset/`,
  DaemonSet: `${DOCS}/concepts/workloads/controllers/daemonset/`,
  ReplicaSet: `${DOCS}/concepts/workloads/controllers/replicaset/`,
  Job: `${DOCS}/concepts/workloads/controllers/job/`,
  CronJob: `${DOCS}/concepts/workloads/controllers/cron-jobs/`,
  Ingress: `${DOCS}/concepts/services-networking/ingress/`,
  NetworkPolicy: `${DOCS}/concepts/services-networking/network-policies/`,
  ConfigMap: `${DOCS}/concepts/configuration/configmap/`,
  Secret: `${DOCS}/concepts/configuration/secret/`,
  Namespace: concept.namespaces,
  ServiceAccount: `${DOCS}/concepts/security/service-accounts/`,
  PersistentVolumeClaim: `${DOCS}/concepts/storage/persistent-volumes/`,
  PersistentVolume: `${DOCS}/concepts/storage/persistent-volumes/`,
  StorageClass: `${DOCS}/concepts/storage/storage-classes/`,
  HorizontalPodAutoscaler: `${DOCS}/tasks/run-application/horizontal-pod-autoscale/`,
  PodDisruptionBudget: `${DOCS}/concepts/workloads/pods/disruptions/`,
  ResourceQuota: `${DOCS}/concepts/policy/resource-quotas/`,
  LimitRange: `${DOCS}/concepts/policy/limit-range/`,
  Role: `${DOCS}/reference/access-authn-authz/rbac/`,
  ClusterRole: `${DOCS}/reference/access-authn-authz/rbac/`,
  RoleBinding: `${DOCS}/reference/access-authn-authz/rbac/`,
  ClusterRoleBinding: `${DOCS}/reference/access-authn-authz/rbac/`,
};

/** True when `prefix` names `rel` or one of its parents: `env` matches `env[].name`, not `envFrom`. */
function startsWithField(rel: string, prefix: string): boolean {
  if (!rel.startsWith(prefix)) return false;
  const next = rel[prefix.length];
  // A prefix ending in a partial word (such as `host`) matches any field that begins with it.
  return prefix === 'host' || next === undefined || next === '.' || next === '[';
}

function find(table: Table, rel: string): string | undefined {
  return table.find(([prefix]) => startsWithField(rel, prefix))?.[1];
}

/**
 * Official Kubernetes documentation for a field: the concept or task page when there is a good
 * one, otherwise the API reference for the enclosing part of the object.
 */
export function docsLinkFor(kind: string | undefined, pattern: string): string | undefined {
  if (kind === undefined || !Object.hasOwn(kindPage, kind)) return undefined;
  const where = locate(kind, pattern);
  if (where.level === 'container') {
    return (
      find(containerLinks, where.rel) ??
      (where.init ? concept.initContainers : `${POD_API}/#Container`)
    );
  }
  if (where.level === 'pod') {
    return find(podLinks, where.rel) ?? `${POD_API}/#PodSpec`;
  }
  return find(objectLinks[kind] ?? metaLinks, where.rel) ?? kindPage[kind];
}

/** Every URL this module can return, for the link checker. */
export function allDocsLinks(): string[] {
  const tables = [containerLinks, podLinks, metaLinks, ...Object.values(objectLinks)];
  const urls = new Set<string>([
    ...tables.flatMap((t) => t.map(([, url]) => url)),
    ...Object.values(kindPage),
    `${POD_API}/#Container`,
    `${POD_API}/#PodSpec`,
    concept.initContainers,
  ]);
  return [...urls];
}
