import { objectMetaDocs, withPrefix } from './pod.js';
import type { FieldDocs } from './pod.js';

export const serviceDocs: FieldDocs = {
  apiVersion: 'Which version of the Kubernetes API this object uses. For a Service it is "v1".',
  kind: 'What type of object this is. A Service gives a stable address and name to a changing set of Pods.',
  metadata:
    'Identifying information about the Service: its name, namespace, labels and annotations.',
  ...withPrefix('metadata', objectMetaDocs),
  spec: 'The desired state of the Service: which Pods it targets and how it is exposed.',
  'spec.type':
    'How the Service is exposed. ClusterIP (default) is reachable only inside the cluster; NodePort opens a port on every node; LoadBalancer asks the cloud provider for an external load balancer; ExternalName maps to a DNS name.',
  'spec.selector':
    'Traffic goes to Pods that have all of these labels. A Service without a selector does not route anywhere by itself.',
  'spec.selector.*': 'One label a Pod must have to receive traffic from this Service.',
  'spec.ports': 'The ports the Service listens on and where it forwards them.',
  'spec.ports[].name': 'A name for this port. Required when the Service has more than one port.',
  'spec.ports[].protocol': 'TCP, UDP or SCTP. Defaults to TCP.',
  'spec.ports[].port': 'The port the Service itself listens on.',
  'spec.ports[].targetPort':
    'The port on the Pods to forward traffic to, as a number or a named container port. Defaults to the value of "port".',
  'spec.ports[].nodePort':
    'For NodePort and LoadBalancer Services, the port opened on every node (30000-32767 by default). Leave it out to have one assigned.',
  'spec.ports[].appProtocol': 'A hint about the application protocol, such as "http" or "grpc".',
  'spec.clusterIP':
    'The Service\'s internal IP address. It is assigned automatically; set it to "None" for a headless Service that exposes the Pods\' own IPs.',
  'spec.externalName': 'For type ExternalName, the DNS name the Service points to.',
  'spec.sessionAffinity':
    'Set to ClientIP to send repeated requests from the same client to the same Pod. Defaults to None.',
  'spec.externalTrafficPolicy':
    'For NodePort and LoadBalancer Services: Cluster spreads traffic across all Pods; Local keeps it on Pods of the receiving node and preserves the client IP.',
  'spec.loadBalancerSourceRanges': 'Only allow traffic to the load balancer from these IP ranges.',
  'spec.publishNotReadyAddresses': 'If true, Pods are listed in DNS even before they are ready.',
};
