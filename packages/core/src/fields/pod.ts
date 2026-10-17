/**
 * Hand-written field explanations, keyed by field pattern (list indexes collapsed to `[]`,
 * `*` standing for any user-chosen map key). This is replaced by a dataset generated from the
 * Kubernetes OpenAPI spec in a later milestone.
 */
export type FieldDocs = Record<string, string>;

/** Re-key every entry of `docs` under `prefix`, e.g. for a Pod spec embedded in a Deployment. */
export function withPrefix(prefix: string, docs: FieldDocs): FieldDocs {
  return Object.fromEntries(Object.entries(docs).map(([k, v]) => [`${prefix}.${k}`, v]));
}

export const objectMetaDocs: FieldDocs = {
  name: 'The name of this object. It must be unique among objects of the same kind in the namespace.',
  namespace:
    'The namespace this object lives in. Namespaces split a cluster into separate areas; if you leave this out, the object goes into the "default" namespace.',
  labels:
    'Key/value tags you attach to the object. Other objects (such as a Service or a Deployment) use labels to find the objects they should manage or send traffic to.',
  'labels.*': 'One label. Selectors elsewhere in the cluster match on this key and value.',
  annotations:
    'Key/value notes attached to the object. Unlike labels they are not used for selecting objects; tools and humans read them for extra information.',
  'annotations.*': 'One annotation. Its meaning depends on the tool or person that reads it.',
  generateName:
    'A prefix Kubernetes uses to generate a unique name for you when you do not set "name".',
};

export const probeDocs: FieldDocs = {
  httpGet: 'Check health by sending an HTTP GET request to the container.',
  'httpGet.path': 'The URL path to request, for example /healthz.',
  'httpGet.port': 'The container port to send the request to, as a number or a named port.',
  'httpGet.scheme': 'Use HTTP or HTTPS for the request. Defaults to HTTP.',
  tcpSocket: 'Check health by trying to open a TCP connection to the container.',
  'tcpSocket.port': 'The container port to connect to.',
  exec: 'Check health by running a command inside the container. Exit code 0 means healthy.',
  'exec.command': 'The command to run inside the container.',
  grpc: 'Check health using the gRPC health checking protocol.',
  'grpc.port': 'The gRPC port to check.',
  initialDelaySeconds:
    'How many seconds to wait after the container starts before the first check.',
  periodSeconds: 'How often, in seconds, to run the check. Defaults to 10.',
  timeoutSeconds: 'How many seconds to wait for a check to answer before counting it as failed.',
  successThreshold:
    'How many consecutive successes are needed before the container counts as healthy again after a failure.',
  failureThreshold:
    'How many consecutive failures are needed before Kubernetes acts: restarting the container (liveness) or removing it from traffic (readiness).',
};

export const containerDocs: FieldDocs = {
  name: 'A name for this container, unique within the Pod. Used in logs and kubectl commands.',
  image:
    'The container image to run, for example nginx:1.27. Pin a specific version tag; "latest" or no tag can change underneath you.',
  imagePullPolicy:
    'When Kubernetes downloads the image: Always, IfNotPresent, or Never. Defaults to Always for the "latest" tag and IfNotPresent otherwise.',
  command:
    "Overrides the image's default entrypoint (the program that starts). Written as a list, one word per item.",
  args: "Arguments passed to the entrypoint. Overrides the image's default arguments.",
  workingDir: 'The directory the container starts in. Overrides the image default.',
  ports:
    'Ports this container listens on. This is mostly documentation; it does not open or block anything.',
  'ports[].containerPort': 'The port number the application listens on inside the container.',
  'ports[].name':
    'A name for this port (up to 15 characters) that Services can refer to instead of the number.',
  'ports[].protocol': 'TCP, UDP or SCTP. Defaults to TCP.',
  'ports[].hostPort':
    'Also expose this port on the node itself. Rarely needed and limits where the Pod can be scheduled.',
  env: 'Environment variables set inside the container.',
  'env[].name': 'The name of the environment variable.',
  'env[].value': 'The value of the environment variable, written directly in the manifest.',
  'env[].valueFrom':
    'Take the value from somewhere else: a Secret, a ConfigMap, or a field of the Pod itself.',
  'env[].valueFrom.secretKeyRef': 'Read the value from one key of a Secret.',
  'env[].valueFrom.configMapKeyRef': 'Read the value from one key of a ConfigMap.',
  'env[].valueFrom.fieldRef': 'Read the value from a field of the Pod, such as its name or IP.',
  envFrom: 'Load every key of a ConfigMap or Secret as environment variables.',
  resources:
    'How much CPU and memory the container asks for (requests) and is allowed to use (limits).',
  'resources.requests':
    'The minimum resources the container needs. The scheduler uses this to pick a node with enough room.',
  'resources.requests.cpu': 'CPU requested. "500m" means half a CPU core; "1" means one core.',
  'resources.requests.memory': 'Memory requested, for example 128Mi or 1Gi.',
  'resources.limits':
    'The maximum resources the container may use. Going over the memory limit gets the container killed; going over the CPU limit slows it down.',
  'resources.limits.cpu': 'The most CPU the container may use. "500m" means half a CPU core.',
  'resources.limits.memory':
    'The most memory the container may use. The container is killed (OOMKilled) if it goes over.',
  volumeMounts: "Where to attach volumes (storage) inside the container's filesystem.",
  'volumeMounts[].name': 'The name of a volume defined in the Pod\'s "volumes" list.',
  'volumeMounts[].mountPath': 'The directory inside the container where the volume appears.',
  'volumeMounts[].readOnly': 'If true, the container can read the volume but not write to it.',
  'volumeMounts[].subPath':
    'Mount only this sub-directory of the volume instead of the whole thing.',
  livenessProbe:
    'A health check that tells Kubernetes whether the container is still working. If it keeps failing, the container is restarted.',
  readinessProbe:
    'A health check that tells Kubernetes whether the container is ready to receive traffic. While it fails, Services stop sending requests to this Pod.',
  startupProbe:
    'A health check for slow-starting containers. Liveness and readiness checks wait until this succeeds.',
  ...withPrefix('livenessProbe', probeDocs),
  ...withPrefix('readinessProbe', probeDocs),
  ...withPrefix('startupProbe', probeDocs),
  securityContext: 'Security settings for this container, such as which user it runs as.',
  'securityContext.runAsNonRoot':
    'If true, Kubernetes refuses to start the container if it would run as root (user 0).',
  'securityContext.runAsUser': 'The numeric user ID to run the container process as.',
  'securityContext.runAsGroup': 'The numeric group ID to run the container process as.',
  'securityContext.privileged':
    'If true, the container gets almost the same access as a process on the node itself. Avoid unless you really need it.',
  'securityContext.allowPrivilegeEscalation':
    'Whether a process in the container can gain more privileges than its parent. Setting this to false is a good default.',
  'securityContext.readOnlyRootFilesystem':
    'If true, the container cannot write to its own filesystem, which limits what an attacker can change.',
  'securityContext.capabilities':
    'Fine-grained Linux permissions to add to or remove from the container.',
  'securityContext.capabilities.add': 'Extra Linux capabilities to give the container.',
  'securityContext.capabilities.drop':
    'Linux capabilities to remove. Dropping ALL and adding back only what you need is a common hardening step.',
  'securityContext.seccompProfile':
    'Restricts which system calls the container may make. RuntimeDefault is a sensible choice.',
  'securityContext.seccompProfile.type': 'RuntimeDefault, Localhost or Unconfined.',
  lifecycle: 'Hooks that run right after the container starts or right before it stops.',
  terminationMessagePath: 'A file the container can write to explain why it stopped.',
  stdin: 'Keep standard input open for the container, for interactive use.',
  tty: 'Allocate a terminal for the container, for interactive use.',
};

export const podSpecDocs: FieldDocs = {
  containers: 'The containers that run in this Pod. They share networking and can share volumes.',
  initContainers:
    'Containers that run one after another, to completion, before the main containers start. Useful for setup work.',
  ...withPrefix('containers[]', containerDocs),
  ...withPrefix('initContainers[]', containerDocs),
  volumes: 'Storage that containers in the Pod can mount.',
  'volumes[].name': 'A name for this volume. Containers refer to it from volumeMounts.',
  'volumes[].emptyDir':
    'A scratch directory created empty when the Pod starts and deleted when it ends.',
  'volumes[].configMap': 'Fill the volume with the contents of a ConfigMap.',
  'volumes[].secret': 'Fill the volume with the contents of a Secret.',
  'volumes[].persistentVolumeClaim':
    'Use storage that outlives the Pod, requested through a PersistentVolumeClaim.',
  'volumes[].hostPath':
    "Mount a directory from the node itself. Risky: it exposes the node's filesystem to the Pod.",
  restartPolicy:
    'What happens when a container exits: Always, OnFailure or Never. Pods managed by a Deployment must use Always.',
  serviceAccountName:
    'The ServiceAccount this Pod runs as. It decides what the Pod may do through the Kubernetes API.',
  automountServiceAccountToken:
    "Whether to place the ServiceAccount's API token inside the containers. Set to false if the Pod never calls the Kubernetes API.",
  nodeSelector: 'Only schedule the Pod on nodes that have all of these labels.',
  'nodeSelector.*': 'One node label the node must have.',
  affinity:
    'Advanced rules for choosing which nodes (or near which other Pods) this Pod should run.',
  tolerations: 'Allows the Pod to be scheduled on nodes that carry matching "taints".',
  hostNetwork:
    "If true, the Pod uses the node's network instead of its own. This weakens isolation.",
  hostPID: 'If true, the Pod can see all processes on the node. This weakens isolation.',
  hostIPC: "If true, the Pod shares the node's inter-process communication space.",
  dnsPolicy: 'How DNS lookups are configured inside the Pod.',
  imagePullSecrets:
    'Names of Secrets that hold credentials for pulling images from a private registry.',
  'imagePullSecrets[].name': 'The name of a Secret of type kubernetes.io/dockerconfigjson.',
  terminationGracePeriodSeconds:
    'How many seconds Kubernetes waits after asking containers to stop before it kills them. Defaults to 30.',
  priorityClassName:
    'Which PriorityClass to use. Higher-priority Pods are scheduled first and evicted last.',
  securityContext:
    'Security settings that apply to the whole Pod, such as the user and group it runs as.',
  'securityContext.runAsNonRoot': 'If true, no container in the Pod may run as root (user 0).',
  'securityContext.runAsUser':
    'The numeric user ID that container processes run as, unless a container overrides it.',
  'securityContext.runAsGroup': 'The numeric group ID that container processes run as.',
  'securityContext.fsGroup':
    'A group ID that is applied to mounted volumes so the containers can read and write them.',
  'securityContext.seccompProfile': 'Restricts which system calls containers in the Pod may make.',
  'securityContext.seccompProfile.type': 'RuntimeDefault, Localhost or Unconfined.',
};

export const podDocs: FieldDocs = {
  apiVersion: 'Which version of the Kubernetes API this object uses. For a Pod it is always "v1".',
  kind: 'What type of object this is. "Pod" is the smallest deployable unit: one or more containers that run together.',
  metadata:
    'Identifying information about the object: its name, namespace, labels and annotations.',
  ...withPrefix('metadata', objectMetaDocs),
  spec: 'The desired state of the Pod: which containers to run and how.',
  ...withPrefix('spec', podSpecDocs),
};
