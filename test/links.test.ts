import { describe, expect, it } from 'vitest';
import { explainManifest } from '../src/core/index.js';
import { allDocsLinks, docsLinkFor } from '../src/core/fields/index.js';
import { locate } from '../src/core/fields/locate.js';
import { run } from '../src/cli/main.js';
import { fileURLToPath } from 'node:url';

const D = 'https://kubernetes.io/docs';

describe('locate', () => {
  it('finds the Pod spec and containers for Pod and Deployment', () => {
    expect(locate('Pod', 'spec.containers[].image')).toEqual({ level: 'container', rel: 'image' });
    expect(locate('Deployment', 'spec.template.spec.initContainers[].image')).toEqual({
      level: 'container',
      rel: 'image',
      init: true,
    });
    expect(locate('Deployment', 'spec.template.spec.volumes[].name')).toEqual({
      level: 'pod',
      rel: 'volumes[].name',
    });
    expect(locate('Deployment', 'spec.replicas')).toEqual({
      level: 'object',
      rel: 'spec.replicas',
    });
    expect(locate('Service', 'spec.ports[].port').level).toBe('object');
  });
});

describe('docsLinkFor', () => {
  it('links container fields to the matching concept page, wherever the Pod spec is nested', () => {
    const resources = `${D}/concepts/configuration/manage-resources-containers/`;
    expect(docsLinkFor('Pod', 'spec.containers[].resources.limits.memory')).toBe(resources);
    expect(docsLinkFor('Deployment', 'spec.template.spec.containers[].resources')).toBe(resources);
    expect(docsLinkFor('Pod', 'spec.containers[].readinessProbe.httpGet.path')).toMatch(/probes/);
    expect(docsLinkFor('Pod', 'spec.containers[].securityContext.privileged')).toMatch(
      /security-context/,
    );
  });

  it('does not confuse env with envFrom or host fields with others', () => {
    expect(docsLinkFor('Pod', 'spec.containers[].env[].name')).toMatch(/environment-variable/);
    expect(docsLinkFor('Pod', 'spec.containers[].envFrom')).toMatch(/#Container$/);
    expect(docsLinkFor('Pod', 'spec.hostNetwork')).toMatch(/pod-security-standards/);
  });

  it('falls back to the API reference, then the page for the kind', () => {
    expect(docsLinkFor('Pod', 'spec.containers[].workingDir')).toBe(
      `${D}/reference/kubernetes-api/workload-resources/pod-v1/#Container`,
    );
    expect(docsLinkFor('Pod', 'spec.somethingElse')).toMatch(/#PodSpec$/);
    expect(docsLinkFor('Deployment', 'spec.replicas')).toBe(
      `${D}/concepts/workloads/controllers/deployment/`,
    );
    expect(docsLinkFor('Service', 'spec.type')).toBe(`${D}/concepts/services-networking/service/`);
    expect(docsLinkFor('Service', 'spec.ports[].port')).toMatch(/#ServicePort$/);
  });

  it('knows nothing about other kinds', () => {
    expect(docsLinkFor('ConfigMap', 'data')).toBeUndefined();
    expect(docsLinkFor(undefined, 'spec')).toBeUndefined();
  });

  it('only uses official kubernetes.io docs links', () => {
    for (const link of allDocsLinks()) expect(link).toMatch(/^https:\/\/kubernetes\.io\/docs\//);
  });
});

describe('explain with links', () => {
  it('attaches docsUrl to explained fields only', () => {
    const [doc] = explainManifest(
      'kind: Pod\nspec:\n  containers:\n    - name: a\n      resources: {}\n      mystery: 1\n',
    ).documents;
    const byPath = (p: string) => doc?.fields.find((f) => f.path === p);
    expect(byPath('spec.containers[0].resources')?.docsUrl).toMatch(/manage-resources/);
    expect(byPath('spec.containers[0].mystery')?.docsUrl).toBeUndefined();
  });

  it('prints each link once per document in the CLI', () => {
    let out = '';
    const file = fileURLToPath(new URL('./fixtures/hardened.yaml', import.meta.url));
    run(['explain', file], { stdout: (t) => (out += t), stderr: () => undefined });
    const docs = out.match(/Docs: \S+/g) ?? [];
    expect(docs.length).toBeGreaterThan(3);
    const deployment = out.split('== Service')[0] ?? '';
    const links = deployment.match(/Docs: \S+/g) ?? [];
    expect(new Set(links).size).toBe(links.length);
  });
});
