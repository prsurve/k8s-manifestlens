import { deploymentDocs } from './deployment.js';
import { allDocsLinks, docsLinkFor } from './links.js';
import { locate } from './locate.js';
import { podDocs, podSpecDocs } from './pod.js';
import { lookupSchema, schemaKinds } from './schema.js';
import type { FieldDocs } from './pod.js';
import { serviceDocs } from './service.js';

/** Field explanations per `kind`. */
const docsByKind: Record<string, FieldDocs> = {
  Pod: podDocs,
  Deployment: deploymentDocs,
  Service: serviceDocs,
};

export function hasDocsFor(kind: string | undefined): boolean {
  return kind !== undefined && (Object.hasOwn(docsByKind, kind) || schemaKinds().includes(kind));
}

/**
 * Look up the explanation for a field pattern. Falls back to a wildcard entry
 * (`labels.*`) so user-chosen map keys still get an explanation.
 */
export function lookupField(kind: string | undefined, pattern: string): string | undefined {
  if (kind === undefined) return undefined;
  return (
    lookupHandWritten(kind, pattern) ?? lookupPodSpec(kind, pattern) ?? lookupSchema(kind, pattern)
  );
}

/** The plain-English explanations written by hand; they take priority over the generated ones. */
function lookupHandWritten(kind: string, pattern: string): string | undefined {
  if (!Object.hasOwn(docsByKind, kind)) return undefined;
  const docs = docsByKind[kind];
  if (docs === undefined) return undefined;
  if (Object.hasOwn(docs, pattern)) return docs[pattern];
  const dot = pattern.lastIndexOf('.');
  if (dot === -1) return undefined;
  const wildcard = `${pattern.slice(0, dot)}.*`;
  return Object.hasOwn(docs, wildcard) ? docs[wildcard] : undefined;
}

/**
 * The hand-written Pod spec text applies wherever a Pod spec appears: a StatefulSet's template,
 * a CronJob's job template and so on.
 */
function lookupPodSpec(kind: string, pattern: string): string | undefined {
  const where = locate(kind, pattern);
  if (where.level === 'object') return undefined;
  const key =
    where.level === 'container'
      ? `${where.init ? 'initContainers' : 'containers'}[].${where.rel}`
      : where.rel;
  if (Object.hasOwn(podSpecDocs, key)) return podSpecDocs[key];
  const dot = key.lastIndexOf('.');
  const wildcard = dot === -1 ? '' : `${key.slice(0, dot)}.*`;
  return wildcard !== '' && Object.hasOwn(podSpecDocs, wildcard)
    ? podSpecDocs[wildcard]
    : undefined;
}

export function supportedKinds(): string[] {
  return [...new Set([...Object.keys(docsByKind), ...schemaKinds()])].sort();
}

export { allDocsLinks, docsLinkFor };
