import { deploymentDocs } from './deployment.js';
import { allDocsLinks, docsLinkFor } from './links.js';
import { podDocs } from './pod.js';
import type { FieldDocs } from './pod.js';
import { serviceDocs } from './service.js';

/** Field explanations per `kind`. */
const docsByKind: Record<string, FieldDocs> = {
  Pod: podDocs,
  Deployment: deploymentDocs,
  Service: serviceDocs,
};

export function hasDocsFor(kind: string | undefined): boolean {
  return kind !== undefined && Object.hasOwn(docsByKind, kind);
}

/**
 * Look up the explanation for a field pattern. Falls back to a wildcard entry
 * (`labels.*`) so user-chosen map keys still get an explanation.
 */
export function lookupField(kind: string | undefined, pattern: string): string | undefined {
  if (kind === undefined || !Object.hasOwn(docsByKind, kind)) return undefined;
  const docs = docsByKind[kind];
  if (docs === undefined) return undefined;
  if (Object.hasOwn(docs, pattern)) return docs[pattern];
  const dot = pattern.lastIndexOf('.');
  if (dot === -1) return undefined;
  const wildcard = `${pattern.slice(0, dot)}.*`;
  return Object.hasOwn(docs, wildcard) ? docs[wildcard] : undefined;
}

export function supportedKinds(): string[] {
  return Object.keys(docsByKind);
}

export { allDocsLinks, docsLinkFor };
