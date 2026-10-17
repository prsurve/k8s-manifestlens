import { schema } from './generated/schema.js';
import { LIST_OF_OBJECTS, MAP_OF_OBJECTS, OBJECT } from './generated/types.js';
import type { FieldDef } from './generated/types.js';
import { objectMetaDocs } from './pod.js';
import type { FieldDocs } from './pod.js';

/** Kinds covered by the generated schema, e.g. StatefulSet or Ingress. */
export function schemaKinds(): string[] {
  return Object.keys(schema.kinds);
}

/** Kubernetes release the schema was generated from. */
export const schemaVersion: string = schema.version;

const META: FieldDocs = {
  metadata:
    'Identifying information about the object: its name, namespace, labels and annotations.',
  ...Object.fromEntries(Object.entries(objectMetaDocs).map(([k, v]) => [`metadata.${k}`, v])),
};

/**
 * Explain a field from the generated schema. `apiVersion`, `kind` and `metadata` get the same
 * beginner-friendly text for every kind; everything else comes from the Kubernetes API reference.
 */
export function lookupSchema(kind: string, pattern: string): string | undefined {
  if (!Object.hasOwn(schema.kinds, kind)) return undefined;
  const info = schema.kinds[kind];
  if (info === undefined) return undefined;

  if (pattern === 'apiVersion') {
    return `Which version of the Kubernetes API this object uses. A ${kind} uses "${info.gv}".`;
  }
  if (pattern === 'kind') return `What type of object this is. ${info.description}`;

  // A Pod template's metadata is ordinary object metadata, wherever the template sits.
  const template = /^(?:spec\.template|spec\.jobTemplate(?:\.spec\.template)?)\.metadata(.*)$/.exec(
    pattern,
  );
  const meta = metaDoc(template ? `metadata${template[1]}` : pattern);
  if (meta !== undefined) return meta;
  return walk(info.type, pattern);
}

function metaDoc(pattern: string): string | undefined {
  if (Object.hasOwn(META, pattern)) return META[pattern];
  const dot = pattern.lastIndexOf('.');
  const wildcard = dot === -1 ? '' : `${pattern.slice(0, dot)}.*`;
  return wildcard !== '' && Object.hasOwn(META, wildcard) ? META[wildcard] : undefined;
}

/** Follow `spec.template.spec.containers[].image` through the type graph to its description. */
function walk(rootType: string, pattern: string): string | undefined {
  let typeId: string | undefined = rootType;
  let description: string | undefined;

  for (const token of pattern.split('.')) {
    if (typeId === undefined) return undefined;
    const fields: Record<string, FieldDef> | undefined = Object.hasOwn(schema.types, typeId)
      ? schema.types[typeId]
      : undefined;
    if (fields === undefined) return undefined;

    const each = token.endsWith('[]');
    const key = each ? token.slice(0, -2) : token;
    const field: FieldDef | undefined = Object.hasOwn(fields, key) ? fields[key] : undefined;
    if (field === undefined) return undefined;

    const [text, shape, type]: FieldDef = field;
    description = text;
    // `[]` steps into list items and a map key steps into the map's values; objects step in directly.
    const steps: boolean = shape === OBJECT || (each && shape === LIST_OF_OBJECTS);
    typeId = steps ? type : undefined;
    if (shape === MAP_OF_OBJECTS) typeId = undefined;
  }
  return description === '' ? undefined : description;
}
