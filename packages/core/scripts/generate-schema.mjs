// Generates src/fields/generated/schema.ts from a Kubernetes OpenAPI spec (swagger.json), so field
// explanations work offline. Usage:
//   node scripts/generate-schema.mjs --spec <swagger.json> --version v1.37.1
// Types are stored once and shared, so the output stays small however deeply the types nest.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: { spec: { type: 'string' }, version: { type: 'string' } },
});
if (!values.spec || !values.version) {
  console.error('Usage: node scripts/generate-schema.mjs --spec <swagger.json> --version <vX.Y.Z>');
  process.exit(2);
}
const spec = JSON.parse(readFileSync(values.spec, 'utf8'));
const defs = spec.definitions;

/** The kinds to include, by OpenAPI definition name. Stable API versions only. */
const ROOTS = {
  Pod: 'io.k8s.api.core.v1.Pod',
  Service: 'io.k8s.api.core.v1.Service',
  ConfigMap: 'io.k8s.api.core.v1.ConfigMap',
  Secret: 'io.k8s.api.core.v1.Secret',
  Namespace: 'io.k8s.api.core.v1.Namespace',
  ServiceAccount: 'io.k8s.api.core.v1.ServiceAccount',
  PersistentVolumeClaim: 'io.k8s.api.core.v1.PersistentVolumeClaim',
  PersistentVolume: 'io.k8s.api.core.v1.PersistentVolume',
  ResourceQuota: 'io.k8s.api.core.v1.ResourceQuota',
  LimitRange: 'io.k8s.api.core.v1.LimitRange',
  Deployment: 'io.k8s.api.apps.v1.Deployment',
  StatefulSet: 'io.k8s.api.apps.v1.StatefulSet',
  DaemonSet: 'io.k8s.api.apps.v1.DaemonSet',
  ReplicaSet: 'io.k8s.api.apps.v1.ReplicaSet',
  Job: 'io.k8s.api.batch.v1.Job',
  CronJob: 'io.k8s.api.batch.v1.CronJob',
  Ingress: 'io.k8s.api.networking.v1.Ingress',
  NetworkPolicy: 'io.k8s.api.networking.v1.NetworkPolicy',
  HorizontalPodAutoscaler: 'io.k8s.api.autoscaling.v2.HorizontalPodAutoscaler',
  PodDisruptionBudget: 'io.k8s.api.policy.v1.PodDisruptionBudget',
  Role: 'io.k8s.api.rbac.v1.Role',
  ClusterRole: 'io.k8s.api.rbac.v1.ClusterRole',
  RoleBinding: 'io.k8s.api.rbac.v1.RoleBinding',
  ClusterRoleBinding: 'io.k8s.api.rbac.v1.ClusterRoleBinding',
  StorageClass: 'io.k8s.api.storage.v1.StorageClass',
};

const OBJECT = 1,
  LIST_OF_OBJECTS = 2,
  LIST_OF_SCALARS = 3,
  MAP_OF_SCALARS = 4,
  MAP_OF_OBJECTS = 5;

const refName = (ref) => ref.replace('#/definitions/', '');
/** `io.k8s.api.apps.v1.Deployment` -> `apps.v1.Deployment` */
const shortId = (name) =>
  name
    .replace(/^io\.k8s\.api\./, '')
    .replace(/^io\.k8s\.apimachinery\.pkg\.apis\./, '')
    .replace(/^io\.k8s\./, '');

/** Shorten an API description: drop "More info" links (we link the docs separately), keep two sentences. */
function clean(text, maxSentences = 2) {
  if (!text) return '';
  let t = text
    .replace(/\s+/g, ' ')
    .replace(/\s*More info:\s*\S+/gi, '')
    .trim();
  const sentences = t.split(/(?<=[.!?])\s+(?=[A-Z"`(])/);
  let out = sentences[0] ?? '';
  for (const s of sentences.slice(1, maxSentences)) {
    if ((out + ' ' + s).length > 300) break;
    out += ' ' + s;
  }
  if (out.length > 420) out = out.slice(0, 417).trimEnd() + '...';
  return out;
}

const isObjectDef = (def) => def && def.properties && Object.keys(def.properties).length > 0;

/** Work out a property's shape; `type` is only set for object shapes. */
function shapeOf(prop) {
  if (prop.$ref) {
    const name = refName(prop.$ref);
    return isObjectDef(defs[name]) ? { shape: OBJECT, type: name } : { shape: 0 };
  }
  if (prop.type === 'array' && prop.items) {
    if (prop.items.$ref) {
      const name = refName(prop.items.$ref);
      return isObjectDef(defs[name])
        ? { shape: LIST_OF_OBJECTS, type: name }
        : { shape: LIST_OF_SCALARS };
    }
    return prop.items.type === 'array' ? { shape: 0 } : { shape: LIST_OF_SCALARS };
  }
  if (
    prop.type === 'object' &&
    prop.additionalProperties &&
    typeof prop.additionalProperties === 'object'
  ) {
    const ap = prop.additionalProperties;
    if (ap.$ref) {
      const name = refName(ap.$ref);
      return isObjectDef(defs[name])
        ? { shape: MAP_OF_OBJECTS, type: name }
        : { shape: MAP_OF_SCALARS };
    }
    return { shape: MAP_OF_SCALARS };
  }
  return { shape: 0 };
}

const types = {};
const queue = [];

function visit(name) {
  const id = shortId(name);
  if (types[id]) return id;
  types[id] = {};
  queue.push(name);
  return id;
}

const kinds = {};
for (const [kind, name] of Object.entries(ROOTS)) {
  const def = defs[name];
  if (!def) throw new Error(`Missing definition ${name}`);
  const gvk = (def['x-kubernetes-group-version-kind'] ?? [])[0];
  if (!gvk) throw new Error(`No group/version/kind for ${name}`);
  kinds[kind] = {
    gv: gvk.group ? `${gvk.group}/${gvk.version}` : gvk.version,
    type: visit(name),
    description: clean(def.description, 1),
  };
}
const rootTypes = new Set(Object.values(kinds).map((k) => k.type));

while (queue.length > 0) {
  const name = queue.shift();
  const out = types[shortId(name)];
  for (const [field, prop] of Object.entries(defs[name].properties ?? {})) {
    // Observed state is never written in a manifest, so skip it at the top level.
    if (field === 'status' && rootTypes.has(shortId(name))) continue;
    const { shape, type } = shapeOf(prop);
    const description = clean(
      prop.description || (prop.$ref ? defs[refName(prop.$ref)]?.description : ''),
    );
    out[field] = type ? [description, shape, visit(type)] : [description, shape];
  }
}

const sortKeys = (o) =>
  Object.fromEntries(
    Object.keys(o)
      .sort()
      .map((k) => [k, o[k]]),
  );
const schema = {
  version: values.version,
  kinds: sortKeys(kinds),
  types: Object.fromEntries(
    Object.keys(types)
      .sort()
      .map((k) => [k, sortKeys(types[k])]),
  ),
};

const target = fileURLToPath(new URL('../src/fields/generated/schema.ts', import.meta.url));
writeFileSync(
  target,
  `// Generated by scripts/generate-schema.mjs from the Kubernetes ${values.version} OpenAPI spec.\n` +
    `// Do not edit. Kubernetes is Apache-2.0 licensed; see NOTICE.\n` +
    `import type { GeneratedSchema } from './types.js';\n\n` +
    `export const schema: GeneratedSchema = ${JSON.stringify(schema)};\n`,
);
const typeCount = Object.keys(types).length;
const fieldCount = Object.values(types).reduce((n, t) => n + Object.keys(t).length, 0);
console.log(
  `Generated ${Object.keys(kinds).length} kinds, ${typeCount} types, ${fieldCount} fields into src/fields/generated/schema.ts`,
);
