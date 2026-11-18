import type { KindPreview } from './crd-importer.js';

/** A plain-text version of the web preview: what a schema can check, and what it cannot. */
export function formatPreview(previews: KindPreview[]): string {
  const out: string[] = [];
  for (const p of previews) {
    out.push(`${p.kind} (${p.group === '' ? 'core' : p.group}), scope: ${p.scope ?? 'not stated'}`);
    for (const v of p.versions) {
      const c = v.capabilities;
      out.push(
        c.level === 'basic'
          ? `  ${v.version}: basic. The kind is recognised, but the schema lists no fields, so nothing inside it is checked.`
          : `  ${v.version}: schema-backed, ${c.fields.length}${c.fieldsTruncated ? '+' : ''} fields, ${c.requiredFields.length} required`,
      );
      if (c.supported.length > 0) out.push(`    checked: ${c.supported.join(', ')}`);
      if (c.unsupported.length > 0) {
        out.push('    NOT checked (no findings does not mean these parts are valid):');
        for (const u of c.unsupported) {
          out.push(`      ${u.keyword} (${u.count}x, first at ${u.firstPath})`);
        }
      }
    }
  }
  return out.join('\n');
}
