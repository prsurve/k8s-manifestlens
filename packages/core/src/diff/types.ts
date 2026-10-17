import type { Finding } from '../rules/types.js';

export type ChangeType = 'added' | 'removed' | 'changed';

/** An enclosing list item identified by its `name`, e.g. the container a field belongs to. */
export interface Within {
  list: string;
  name: string;
}

export interface FieldChange {
  type: ChangeType;
  /** Path in the new file for added/changed fields, in the old file for removed ones. */
  path: string;
  /** Same path with list indexes collapsed. */
  pattern: string;
  before?: unknown;
  after?: unknown;
  /** 1-based line in the new file (added, changed) or the old file (removed). */
  line: number;
  within: Within[];
  /** What this change will do to the cluster, in plain English. */
  effect?: string;
  /** What the field means. */
  explanation?: string;
  docsUrl?: string;
}

export interface DocumentDiff {
  status: 'added' | 'removed' | 'changed' | 'unchanged';
  kind: string;
  name: string;
  namespace?: string;
  apiVersion?: string;
  /** Line where the document starts in the old and new file. */
  oldLine?: number;
  newLine?: number;
  changes: FieldChange[];
  /** Effects of the change as a whole, such as "this triggers a rollout". */
  notes: string[];
  /** Rule findings the change introduces (every finding of an added object). */
  newFindings: Finding[];
  /** Rule findings that exist in the old file and are gone in the new one. */
  resolvedFindings: Finding[];
}

export interface DiffIssue {
  side: 'old' | 'new';
  message: string;
  line?: number;
}

export interface DiffResult {
  documents: DocumentDiff[];
  issues: DiffIssue[];
}
