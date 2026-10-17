import { describe, expect, it } from 'vitest';
import { explainManifest } from '../src/index.js';

function explain(yaml: string, path: string, doc = 0): string | undefined {
  return explainManifest(yaml).documents[doc]?.fields.find((f) => f.path === path)?.explanation;
}

describe('explainManifest', () => {
  it('explains Pod fields', () => {
    const yaml =
      'apiVersion: v1\nkind: Pod\nspec:\n  containers:\n    - name: a\n      image: nginx\n';
    expect(explain(yaml, 'kind')).toMatch(/smallest deployable unit/);
    expect(explain(yaml, 'spec.containers[0].image')).toMatch(/container image/);
  });

  it('explains Deployment fields, including the nested Pod spec', () => {
    const yaml = [
      'kind: Deployment',
      'spec:',
      '  replicas: 3',
      '  template:',
      '    spec:',
      '      containers:',
      '        - name: a',
      '          resources:',
      '            limits:',
      '              memory: 1Gi',
    ].join('\n');
    expect(explain(yaml, 'spec.replicas')).toMatch(/identical Pods/);
    expect(explain(yaml, 'spec.template.spec.containers[0].resources.limits.memory')).toMatch(
      /OOMKilled/,
    );
  });

  it('explains Service fields', () => {
    const yaml = 'kind: Service\nspec:\n  type: NodePort\n  ports:\n    - port: 80\n';
    expect(explain(yaml, 'spec.type')).toMatch(/ClusterIP/);
    expect(explain(yaml, 'spec.ports[0].port')).toMatch(/Service itself listens/);
  });

  it('explains user-chosen map keys through wildcard entries', () => {
    const yaml =
      'kind: Service\nmetadata:\n  labels:\n    team: a\nspec:\n  selector:\n    app: b\n';
    expect(explain(yaml, 'metadata.labels.team')).toMatch(/One label/);
    expect(explain(yaml, 'spec.selector.app')).toMatch(/Pod must have/);
  });

  it('leaves unknown fields without an explanation', () => {
    const yaml = 'kind: Service\nspec:\n  somethingNew: 1\n';
    expect(explain(yaml, 'spec.somethingNew')).toBeUndefined();
  });

  it('marks kinds without a dataset as unsupported and adds no explanations', () => {
    const [doc] = explainManifest('kind: ConfigMap\ndata:\n  a: b\n').documents;
    expect(doc?.unsupportedKind).toBe(true);
    expect(doc?.fields.every((f) => f.explanation === undefined)).toBe(true);
  });

  it('does not treat inherited object properties as kinds or fields', () => {
    const [doc] = explainManifest('kind: constructor\ntoString: x\n').documents;
    expect(doc?.unsupportedKind).toBe(true);
    expect(doc?.fields[0]?.explanation).toBeUndefined();
  });
});
