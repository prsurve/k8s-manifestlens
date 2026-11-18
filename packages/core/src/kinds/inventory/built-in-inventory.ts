/** A Kubernetes built-in resource kind and where it lives in the API. */
export interface BuiltInKind {
  kind: string;
  /** API group; empty for the core group. */
  group: string;
  /** The stable API version the kind is served at. */
  version: string;
  namespaced: boolean;
}

const k = (kind: string, group: string, version: string, namespaced = true): BuiltInKind => ({
  kind,
  group,
  version,
  namespaced,
});

/**
 * Built-in kinds a user may write in a manifest, whether or not the bundled dataset explains them.
 * This list is curated, not generated: it is what lets k8s-manifestlens say "this is a real
 * Kubernetes kind we do not cover yet" instead of calling it a custom resource. Coverage is derived
 * from the generated dataset at run time (see `kind-registry.ts`), never stored here.
 */
export const BUILT_IN_INVENTORY: readonly BuiltInKind[] = [
  k('Pod', '', 'v1'),
  k('Service', '', 'v1'),
  k('ConfigMap', '', 'v1'),
  k('Secret', '', 'v1'),
  k('Namespace', '', 'v1', false),
  k('ServiceAccount', '', 'v1'),
  k('PersistentVolumeClaim', '', 'v1'),
  k('PersistentVolume', '', 'v1', false),
  k('ResourceQuota', '', 'v1'),
  k('LimitRange', '', 'v1'),
  k('Node', '', 'v1', false),
  k('Endpoints', '', 'v1'),
  k('Event', '', 'v1'),
  k('ReplicationController', '', 'v1'),
  k('PodTemplate', '', 'v1'),
  k('Deployment', 'apps', 'v1'),
  k('StatefulSet', 'apps', 'v1'),
  k('DaemonSet', 'apps', 'v1'),
  k('ReplicaSet', 'apps', 'v1'),
  k('ControllerRevision', 'apps', 'v1'),
  k('Job', 'batch', 'v1'),
  k('CronJob', 'batch', 'v1'),
  k('Ingress', 'networking.k8s.io', 'v1'),
  k('IngressClass', 'networking.k8s.io', 'v1', false),
  k('NetworkPolicy', 'networking.k8s.io', 'v1'),
  k('EndpointSlice', 'discovery.k8s.io', 'v1'),
  k('HorizontalPodAutoscaler', 'autoscaling', 'v2'),
  k('PodDisruptionBudget', 'policy', 'v1'),
  k('Role', 'rbac.authorization.k8s.io', 'v1'),
  k('ClusterRole', 'rbac.authorization.k8s.io', 'v1', false),
  k('RoleBinding', 'rbac.authorization.k8s.io', 'v1'),
  k('ClusterRoleBinding', 'rbac.authorization.k8s.io', 'v1', false),
  k('StorageClass', 'storage.k8s.io', 'v1', false),
  k('CSIDriver', 'storage.k8s.io', 'v1', false),
  k('CSINode', 'storage.k8s.io', 'v1', false),
  k('CSIStorageCapacity', 'storage.k8s.io', 'v1'),
  k('VolumeAttachment', 'storage.k8s.io', 'v1', false),
  k('PriorityClass', 'scheduling.k8s.io', 'v1', false),
  k('RuntimeClass', 'node.k8s.io', 'v1', false),
  k('Lease', 'coordination.k8s.io', 'v1'),
  k('CertificateSigningRequest', 'certificates.k8s.io', 'v1', false),
  k('MutatingWebhookConfiguration', 'admissionregistration.k8s.io', 'v1', false),
  k('ValidatingWebhookConfiguration', 'admissionregistration.k8s.io', 'v1', false),
  k('ValidatingAdmissionPolicy', 'admissionregistration.k8s.io', 'v1', false),
  k('ValidatingAdmissionPolicyBinding', 'admissionregistration.k8s.io', 'v1', false),
  k('CustomResourceDefinition', 'apiextensions.k8s.io', 'v1', false),
  k('APIService', 'apiregistration.k8s.io', 'v1', false),
  k('FlowSchema', 'flowcontrol.apiserver.k8s.io', 'v1', false),
  k('PriorityLevelConfiguration', 'flowcontrol.apiserver.k8s.io', 'v1', false),
];

/** Split an apiVersion into its group and version: `apps/v1` is `apps` + `v1`, `v1` is `` + `v1`. */
export function splitApiVersion(apiVersion: string): { group: string; version: string } {
  const slash = apiVersion.indexOf('/');
  return slash === -1
    ? { group: '', version: apiVersion }
    : { group: apiVersion.slice(0, slash), version: apiVersion.slice(slash + 1) };
}

/** Built-in kinds with this name, in any group (a few names, like Event, exist in two groups). */
export function findBuiltIn(kind: string): BuiltInKind[] {
  return BUILT_IN_INVENTORY.filter((b) => b.kind === kind);
}
