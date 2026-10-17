import { describe, expect, it } from 'vitest';
import {
  checkManifest,
  diffManifests,
  explainManifest,
  loadBundledRules,
  supportedKinds,
} from '../src/index.js';
import { docsLinkFor, hasDocsFor, lookupField } from '../src/fields/index.js';
import { schema } from '../src/fields/generated/schema.js';
import { lookupSchema, schemaKinds, schemaVersion } from '../src/fields/schema.js';

describe('generated schema', () => {
  it('covers the common workload, networking, config, storage and RBAC kinds', () => {
    expect(schemaKinds()).toEqual(
      expect.arrayContaining([
        'StatefulSet',
        'DaemonSet',
        'Job',
        'CronJob',
        'Ingress',
        'ConfigMap',
        'Secret',
        'PersistentVolumeClaim',
        'Role',
        'ClusterRoleBinding',
      ]),
    );
    expect(schemaVersion).toMatch(/^v1\.\d+\.\d+$/);
  });

  it('explains nested fields by walking the type graph', () => {
    expect(lookupSchema('StatefulSet', 'spec.serviceName')).toMatch(/service/i);
    expect(
      lookupSchema('StatefulSet', 'spec.volumeClaimTemplates[].spec.storageClassName'),
    ).toMatch(/StorageClass/);
    expect(
      lookupSchema('CronJob', 'spec.jobTemplate.spec.template.spec.containers[].image'),
    ).toMatch(/image name/i);
    expect(lookupSchema('CronJob', 'spec.schedule')).toMatch(/Cron/i);
    expect(lookupSchema('Ingress', 'spec.rules[].host')).toBeTruthy();
    expect(lookupSchema('Job', 'spec.backoffLimit')).toMatch(/retries/i);
    expect(lookupSchema('ConfigMap', 'data')).toBeTruthy();
  });

  it('returns nothing for fields that do not exist, so typos stay unexplained', () => {
    expect(lookupSchema('StatefulSet', 'spec.nonsense')).toBeUndefined();
    expect(lookupSchema('StatefulSet', 'spec.serviceName.deeper')).toBeUndefined();
    expect(lookupSchema('Job', 'spec.template.spec.containers.image')).toBeUndefined(); // missing []
    expect(lookupSchema('Widget', 'spec')).toBeUndefined();
    expect(lookupSchema('Job', '__proto__')).toBeUndefined();
  });

  it('gives apiVersion, kind and metadata friendly text for every kind', () => {
    expect(lookupSchema('StatefulSet', 'apiVersion')).toContain('"apps/v1"');
    expect(lookupSchema('CronJob', 'apiVersion')).toContain('"batch/v1"');
    expect(lookupSchema('Ingress', 'kind')).toMatch(/What type of object this is/);
    expect(lookupSchema('Job', 'metadata.labels')).toMatch(/Key\/value tags/);
    expect(lookupSchema('Job', 'metadata.labels.app')).toMatch(/One label/);
  });

  it('keeps hand-written explanations ahead of generated ones', () => {
    expect(lookupField('Deployment', 'spec.replicas')).toBe(
      'How many identical Pods to keep running. Defaults to 1.',
    );
    expect(lookupField('Pod', 'spec.containers[].image')).toMatch(/Pin a specific version tag/);
    // A Pod field nobody wrote by hand still gets an explanation from the schema.
    expect(lookupField('Pod', 'spec.hostname')).toBeTruthy();
  });

  it('reuses the hand-written Pod text inside any kind that has a Pod template', () => {
    expect(lookupField('StatefulSet', 'spec.template.spec.containers[].name')).toBe(
      'A name for this container, unique within the Pod. Used in logs and kubectl commands.',
    );
    expect(
      lookupField('CronJob', 'spec.jobTemplate.spec.template.spec.initContainers[].image'),
    ).toMatch(/Pin a specific version tag/);
    expect(lookupField('DaemonSet', 'spec.template.spec.nodeSelector.disk')).toMatch(/node label/);
    expect(
      lookupField('Job', 'spec.template.spec.containers[].securityContext.privileged'),
    ).toMatch(/almost the same access/);
    // Fields without hand-written text still fall back to the generated one.
    expect(
      lookupField('StatefulSet', 'spec.template.spec.containers[].terminationMessagePolicy'),
    ).toBeTruthy();
  });

  it("explains a Pod template's metadata like any other metadata", () => {
    expect(lookupSchema('StatefulSet', 'spec.template.metadata.labels')).toMatch(/Key\/value tags/);
    expect(lookupSchema('StatefulSet', 'spec.template.metadata.labels.app')).toMatch(/One label/);
    expect(lookupSchema('CronJob', 'spec.jobTemplate.metadata.annotations')).toMatch(
      /Key\/value notes/,
    );
  });

  it('describes a kind in one sentence', () => {
    for (const info of Object.values(schema.kinds)) {
      expect(info.description.split(/(?<=\.)\s/).length).toBe(1);
    }
  });

  it('lists every covered kind as supported', () => {
    expect(supportedKinds()).toEqual(expect.arrayContaining(['Pod', 'Service', 'Job', 'Role']));
    expect(hasDocsFor('CronJob')).toBe(true);
    expect(hasDocsFor('Widget')).toBe(false);
  });

  it('has clean descriptions: no links to follow, no raw whitespace, not empty for common fields', () => {
    const all = Object.values(schema.types).flatMap((t) => Object.values(t).map((f) => f[0]));
    expect(all.some((d) => /More info:/i.test(d))).toBe(false);
    expect(all.some((d) => /\s{2,}|\n/.test(d))).toBe(false);
    expect(all.every((d) => d.length <= 420)).toBe(true);
    // Every type a field points at exists.
    for (const fields of Object.values(schema.types)) {
      for (const [, , type] of Object.values(fields)) {
        if (type !== undefined) expect(schema.types).toHaveProperty([type]);
      }
    }
  });
});

const STATEFUL = `apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: db
spec:
  serviceName: db
  replicas: 3
  template:
    spec:
      containers:
        - name: db
          image: postgres
`;

describe('other workload kinds', () => {
  it('explain StatefulSet fields, including the Pod template', () => {
    const [doc] = explainManifest(STATEFUL).documents;
    expect(doc?.unsupportedKind).toBe(false);
    const find = (p: string) => doc?.fields.find((f) => f.path === p);
    expect(find('apiVersion')?.explanation).toContain('"apps/v1"');
    expect(find('spec.serviceName')?.explanation).toMatch(/service/i);
    expect(find('spec.template.spec.containers[0].image')?.explanation).toMatch(/container image/);
    expect(find('spec.template.spec.containers[0].image')?.docsUrl).toMatch(
      /concepts\/containers\/images/,
    );
    expect(find('spec.serviceName')?.docsUrl).toMatch(/statefulset/);
  });

  it('apply the container and Pod rules to every kind that runs Pods', () => {
    const rules = loadBundledRules();
    const ids = (yaml: string) =>
      checkManifest(yaml, rules)
        .documents.flatMap((d) => d.findings)
        .map((f) => f.ruleId);
    expect(ids(STATEFUL)).toEqual(
      expect.arrayContaining(['image-latest-tag', 'missing-memory-limit']),
    );

    const job =
      'kind: Job\nspec:\n  template:\n    spec:\n      containers:\n        - name: a\n          image: x\n';
    expect(ids(job)).toContain('image-latest-tag');
    const cron =
      'kind: CronJob\nspec:\n  jobTemplate:\n    spec:\n      template:\n        spec:\n          hostNetwork: true\n          containers:\n            - name: a\n              image: x:1\n';
    expect(ids(cron)).toEqual(expect.arrayContaining(['host-namespaces', 'missing-memory-limit']));
    const daemon =
      'kind: DaemonSet\nspec:\n  template:\n    spec:\n      containers:\n        - name: a\n          image: x:1\n';
    expect(ids(daemon)).toContain('missing-readiness-probe');
  });

  it('point rule findings at the right line inside the template', () => {
    const [doc] = checkManifest(STATEFUL, loadBundledRules()).documents;
    expect(doc?.findings.find((f) => f.ruleId === 'image-latest-tag')?.line).toBe(12);
  });

  it('leave kinds without a Pod spec alone', () => {
    const cm = 'kind: ConfigMap\ndata:\n  a: b\n';
    expect(checkManifest(cm, loadBundledRules()).documents[0]?.findings).toEqual([]);
  });

  it('explain scaling a StatefulSet', () => {
    const [doc] = diffManifests(
      STATEFUL,
      STATEFUL.replace('replicas: 3', 'replicas: 5'),
      [],
    ).documents;
    expect(doc?.changes[0]?.effect).toMatch(/2 more Pods/);
    expect(doc?.notes[0]).toMatch(/no rollout/);
  });

  it('describe what a template change does for each controller', () => {
    const note = (kind: string, yaml: string) => {
      const next = yaml.replace('image: x:1', 'image: x:2');
      return diffManifests(yaml, next, []).documents[0]?.notes[0];
    };
    const workload = (kind: string) =>
      `kind: ${kind}\nmetadata:\n  name: w\nspec:\n  template:\n    spec:\n      containers:\n        - name: a\n          image: x:1\n`;
    expect(note('StatefulSet', workload('StatefulSet'))).toMatch(/one at a time/);
    expect(note('DaemonSet', workload('DaemonSet'))).toMatch(/node by node/);
    expect(note('ReplicaSet', workload('ReplicaSet'))).toMatch(
      /does not update Pods it already runs/,
    );
    expect(note('Job', workload('Job'))).toMatch(/does not allow changing a Job/);
    const cron = `kind: CronJob\nmetadata:\n  name: w\nspec:\n  jobTemplate:\n    spec:\n      template:\n        spec:\n          containers:\n            - name: a\n              image: x:1\n`;
    expect(note('CronJob', cron)).toMatch(/next run/);
  });

  it('name the container in effects for controllers without repeating the rollout', () => {
    const next = STATEFUL.replace('postgres', 'postgres:16');
    const [doc] = diffManifests(STATEFUL, next, []).documents;
    const effect = doc?.changes.find((c) => c.path.endsWith('image'))?.effect;
    expect(effect).toContain('Container "db" will run postgres:16 instead of postgres');
    expect(effect).not.toMatch(/rollout|restarts/);
  });

  it('links workload kinds to their concept pages', () => {
    expect(docsLinkFor('Job', 'spec.backoffLimit')).toMatch(/controllers\/job\/$/);
    expect(docsLinkFor('CronJob', 'spec.schedule')).toMatch(/cron-jobs\/$/);
    expect(docsLinkFor('StatefulSet', 'spec.template.spec.containers[].resources')).toMatch(
      /manage-resources-containers/,
    );
    expect(docsLinkFor('Role', 'rules')).toMatch(/rbac/);
  });
});
