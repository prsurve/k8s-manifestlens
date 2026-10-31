import diffNew from '../../../examples/diff-new.yaml?raw';
import diffOld from '../../../examples/diff-old.yaml?raw';
import risky from '../../../examples/risky.yaml?raw';
import hardened from '../../../examples/hardened.yaml?raw';
import web from '../../../examples/web.yaml?raw';

/** Fix tab examples: the risk to allow, a policy to fill in when the fixes need one, and the manifest. */
export const fixExamples = {
  low: {
    risk: 'low',
    policy: '',
    text: `# Low risk: applied by default. The memory limit is held back until you give a value.
apiVersion: v1
kind: Pod
metadata:
  name: low-risk
spec:
  containers:
    - name: app
      image: nginx:1.27
      securityContext:
        runAsNonRoot: true
`,
  },
  medium: {
    risk: 'medium',
    policy: 'params:\n  memoryLimit: 256Mi\n',
    text: `# Medium risk: runAsNonRoot can stop an image that runs as root, and the limit comes from the policy.
apiVersion: v1
kind: Pod
metadata:
  name: medium-risk
spec:
  containers:
    - name: app
      image: nginx:1.27
`,
  },
  high: {
    risk: 'high',
    policy: '',
    text: `# High risk: a privileged container may need that access, so review the change.
apiVersion: v1
kind: Pod
metadata:
  name: high-risk
spec:
  containers:
    - name: app
      image: nginx:1.27
      securityContext:
        privileged: true
`,
  },
  none: { risk: 'low', policy: '', text: hardened },
} as const;

export const examples = {
  explain: web,
  check: risky,
  fix: risky,
  diff: { old: diffOld, new: diffNew },
};

/** One-resource starting points for the editor's "Quick start" menu. */
export const quickStarts = {
  deployment: {
    label: 'Deployment',
    text: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  labels:
    app: web
spec:
  replicas: 2
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: web
          image: nginx:1.27
          ports:
            - containerPort: 80
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              memory: 256Mi
`,
  },
  service: {
    label: 'Service',
    text: `apiVersion: v1
kind: Service
metadata:
  name: web
spec:
  type: ClusterIP
  selector:
    app: web
  ports:
    - port: 80
      targetPort: 80
`,
  },
  ingress: {
    label: 'Ingress',
    text: `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web
spec:
  rules:
    - host: web.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: web
                port:
                  number: 80
`,
  },
  configmap: {
    label: 'ConfigMap',
    text: `apiVersion: v1
kind: ConfigMap
metadata:
  name: web-config
data:
  LOG_LEVEL: info
  FEATURE_X: "true"
`,
  },
  secret: {
    label: 'Secret',
    text: `apiVersion: v1
kind: Secret
metadata:
  name: web-secret
type: Opaque
stringData:
  API_TOKEN: replace-me
`,
  },
} as const;

/**
 * A custom resource and the CRD that describes it. "example.com/Widget" is made up for this demo:
 * it shows what the Custom resources box does, not a real operator.
 */
export const customResourceExample = {
  label: 'Custom resource + CRD',
  crd: `apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: widgets.example.com
spec:
  group: example.com
  names:
    kind: Widget
    plural: widgets
  scope: Namespaced
  versions:
    - name: v1
      served: true
      storage: true
      schema:
        openAPIV3Schema:
          type: object
          properties:
            spec:
              type: object
              required: [size]
              properties:
                size:
                  type: integer
                  minimum: 1
                  description: How many sprockets the widget has.
                mode:
                  type: string
                  enum: [fast, slow]
                  description: Which speed profile to use.
`,
  text: `apiVersion: example.com/v1
kind: Widget
metadata:
  name: demo
spec:
  size: 0
  mode: medium
  colour: red
`,
};

/** Starter rules for the "Your own rules" box, in the documented plain-YAML format. */
export const exampleRules = `# Every Deployment must say which team owns it.
id: team-label-required
title: Deployment has no team label
severity: warning
kinds: [Deployment]
when:
  missing: metadata.labels.team
report: metadata
message: 'Deployment "{name}" has no "team" label.'
why: Without an owner label nobody knows who to ask when this workload misbehaves.
fix: 'Add metadata.labels.team, for example: team: payments.'
---
# Images must not use the floating "latest" tag.
id: no-latest-tag
title: Image uses the latest tag
severity: error
kinds: [Pod, Deployment]
scope: container
when:
  matches:
    image: ':latest$'
report: image
message: 'Container "{container}" uses a "latest" image tag.'
why: "latest points at a different image over time, so two rollouts of the same manifest can run different code."
fix: Pin the image to a version tag or digest.
`;
