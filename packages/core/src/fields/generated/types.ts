/** Field shapes in the generated schema. */
export const SCALAR = 0;
export const OBJECT = 1;
export const LIST_OF_OBJECTS = 2;
export const LIST_OF_SCALARS = 3;
export const MAP_OF_SCALARS = 4;
export const MAP_OF_OBJECTS = 5;

/** `[description, shape, type]`: `type` names an entry of `types` for the object shapes. */
export type FieldDef = [description: string, shape: number, type?: string];

export interface GeneratedSchema {
  /** Kubernetes release the schema was generated from, e.g. `v1.37.1`. */
  version: string;
  /** Top-level kinds: the apiVersion they use, their root type and what they are. */
  kinds: Record<string, { gv: string; type: string; description: string }>;
  types: Record<string, Record<string, FieldDef>>;
}
