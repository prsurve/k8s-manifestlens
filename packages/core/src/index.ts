export { looksLikeKubernetes } from './detect.js';
export { explainManifest } from './explain.js';
export { supportedKinds } from './fields/index.js';
export { parseManifest } from './parse.js';
export type {
  ExplainResult,
  ExplainedDocument,
  ExplainedField,
  FieldNode,
  ManifestDocument,
  ParseIssue,
} from './types.js';
export * from './rules/index.js';
export * from './fix/index.js';
export * from './diff/index.js';
export { show as formatValue } from './diff/effects.js';
