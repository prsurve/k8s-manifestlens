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
export { analyzeSchema, SUPPORTED_CONSTRAINTS } from './schema/schema-capabilities.js';
export type {
  SchemaCapabilities,
  SchemaField,
  SupportedConstraint,
  UnsupportedFeature,
} from './schema/schema-capabilities.js';
export { importCrds, previewRules } from './onboarding/crd-importer.js';
export type { KindPreview, KindPreviewVersion } from './onboarding/crd-importer.js';
export { importOpenApi } from './onboarding/schema-importer.js';
export type { SchemaIdentity } from './onboarding/schema-importer.js';
export { registerKinds } from './onboarding/kind-registration.js';
export type { RegistrationResult, RejectedKind } from './onboarding/kind-registration.js';
