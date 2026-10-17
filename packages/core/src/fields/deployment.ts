import { objectMetaDocs, podSpecDocs, withPrefix } from './pod.js';
import type { FieldDocs } from './pod.js';

export const deploymentDocs: FieldDocs = {
  apiVersion: 'Which version of the Kubernetes API this object uses. Deployments use "apps/v1".',
  kind: 'What type of object this is. A Deployment keeps a set of identical Pods running and handles rolling updates.',
  metadata:
    'Identifying information about the Deployment: its name, namespace, labels and annotations.',
  ...withPrefix('metadata', objectMetaDocs),
  spec: 'The desired state of the Deployment: how many Pods, which Pods, and how to update them.',
  'spec.replicas': 'How many identical Pods to keep running. Defaults to 1.',
  'spec.selector':
    'How the Deployment finds the Pods it owns. It must match the labels in the Pod template.',
  'spec.selector.matchLabels': 'Pods must have all of these labels to belong to this Deployment.',
  'spec.selector.matchLabels.*':
    "One label a Pod must have. It must also appear in the template's labels.",
  'spec.strategy': 'How old Pods are replaced by new ones when the Deployment changes.',
  'spec.strategy.type':
    'RollingUpdate replaces Pods gradually with no downtime; Recreate stops all old Pods first, then starts new ones.',
  'spec.strategy.rollingUpdate': 'Settings for the RollingUpdate strategy.',
  'spec.strategy.rollingUpdate.maxSurge':
    'How many extra Pods may be created above the desired count during an update. A number or a percentage.',
  'spec.strategy.rollingUpdate.maxUnavailable':
    'How many Pods may be unavailable during an update. A number or a percentage.',
  'spec.minReadySeconds':
    'How long a new Pod must be ready, without crashing, before it counts as available.',
  'spec.revisionHistoryLimit':
    'How many old ReplicaSets to keep so you can roll back. Defaults to 10.',
  'spec.progressDeadlineSeconds':
    'How long to wait for an update to make progress before reporting it as failed. Defaults to 600.',
  'spec.paused': 'If true, changes to the Pod template do not trigger a rollout.',
  'spec.template': 'The blueprint for the Pods this Deployment creates.',
  'spec.template.metadata': 'Metadata given to each Pod that is created.',
  ...withPrefix('spec.template.metadata', objectMetaDocs),
  'spec.template.spec': 'The Pod specification: which containers to run and how.',
  ...withPrefix('spec.template.spec', podSpecDocs),
};
