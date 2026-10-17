import { docsLinkFor, hasDocsFor, lookupField } from './fields/index.js';
import { parseManifest } from './parse.js';
import type { ExplainResult, ExplainedField } from './types.js';

/** Parse a manifest and attach a plain-English explanation to every field we know about. */
export function explainManifest(source: string): ExplainResult {
  const documents = parseManifest(source).map((doc) => ({
    ...doc,
    unsupportedKind: !hasDocsFor(doc.kind),
    fields: doc.fields.map((field): ExplainedField => {
      const explanation = lookupField(doc.kind, field.pattern);
      if (explanation === undefined) return field;
      const docsUrl = docsLinkFor(doc.kind, field.pattern);
      return { ...field, explanation, ...(docsUrl !== undefined ? { docsUrl } : {}) };
    }),
  }));
  return { documents };
}
