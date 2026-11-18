import type { Rule } from '../../rules/types.js';
import { parseCrds } from '../../rules/crd.js';
import { analyzeSchema } from '../schema/schema-capabilities.js';
import type { SchemaCapabilities } from '../schema/schema-capabilities.js';

export interface KindPreviewVersion {
  version: string;
  capabilities: SchemaCapabilities;
}

/** What importing a schema would add, shown before anything is registered. */
export interface KindPreview {
  group: string;
  kind: string;
  scope?: 'Namespaced' | 'Cluster';
  source: 'crd' | 'openapi';
  versions: KindPreviewVersion[];
}

/** Group compiled rules into one preview per group and kind. */
export function previewRules(rules: Rule[]): KindPreview[] {
  const previews = new Map<string, KindPreview>();
  for (const { crd } of rules) {
    if (crd === undefined) continue;
    const id = `${crd.group}/${crd.kind}`;
    let preview = previews.get(id);
    if (preview === undefined) {
      preview = {
        group: crd.group,
        kind: crd.kind,
        ...(crd.scope ? { scope: crd.scope } : {}),
        source: crd.source ?? 'crd',
        versions: [],
      };
      previews.set(id, preview);
    }
    preview.versions.push({ version: crd.version, capabilities: analyzeSchema(crd.schema) });
  }
  return [...previews.values()];
}

/** Parse pasted or uploaded CRD YAML (several documents allowed) with the existing parser. */
export function importCrds(
  text: string,
  origin = 'crd',
): { rules: Rule[]; previews: KindPreview[] } {
  const rules = parseCrds(text, origin);
  return { rules, previews: previewRules(rules) };
}
