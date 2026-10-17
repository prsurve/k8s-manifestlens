/** One key in a manifest, with where it sits in the source text. */
export interface FieldNode {
  /** Dotted path with list indexes, e.g. `spec.template.spec.containers[0].image`. */
  path: string;
  /** Same path with indexes collapsed, e.g. `spec.template.spec.containers[].image`. */
  pattern: string;
  /** The key itself, e.g. `image`. */
  key: string;
  /** 1-based line of the key. */
  line: number;
  /** 1-based column of the key. */
  column: number;
  /** Nesting depth, 0 for top-level keys. */
  depth: number;
  type: 'scalar' | 'map' | 'list';
  /** Scalar value as written in the manifest; absent for maps and lists. */
  value?: string;
}

export interface ParseIssue {
  message: string;
  /** 1-based line, when known. */
  line?: number;
}

/** One YAML document from a (possibly multi-document) manifest file. */
export interface ManifestDocument {
  /** 0-based position among the documents in the file. */
  index: number;
  /** 1-based line where the document's content starts. */
  startLine: number;
  apiVersion?: string;
  kind?: string;
  name?: string;
  /** The document as plain JavaScript data, for rules to inspect. Absent if it is not a mapping. */
  data?: Record<string, unknown>;
  fields: FieldNode[];
  issues: ParseIssue[];
}

export interface ExplainedField extends FieldNode {
  /** Plain-English explanation, absent when the dataset has nothing for this field. */
  explanation?: string;
}

export interface ExplainedDocument extends Omit<ManifestDocument, 'fields'> {
  fields: ExplainedField[];
  /** True when the dataset has no field explanations for this kind. */
  unsupportedKind: boolean;
}

export interface ExplainResult {
  documents: ExplainedDocument[];
}
