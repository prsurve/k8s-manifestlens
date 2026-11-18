export {
  BUILT_IN_INVENTORY,
  findBuiltIn,
  splitApiVersion,
} from './inventory/built-in-inventory.js';
export type { BuiltInKind } from './inventory/built-in-inventory.js';
export { classifyKind } from './registry/kind-classifier.js';
export type { KindCategory, KindClassification } from './registry/kind-classifier.js';
export {
  SOURCE_PRECEDENCE,
  buildRegistry,
  detectConflicts,
  resolveKind,
} from './registry/kind-registry.js';
export type { KindConflict, KindEntry, KindSource } from './registry/kind-registry.js';
