export type Severity = 'info' | 'warning' | 'error';
export type RuleScope = 'document' | 'pod' | 'container' | 'initContainer';

/** A parsed and validated rule condition. Paths are relative to the rule's scope. */
export type Condition =
  | { op: 'missing' | 'present'; path: string }
  | { op: 'equals' | 'contains'; path: string; value: unknown }
  | { op: 'in'; path: string; values: unknown[] }
  | { op: 'matches'; path: string; pattern: RegExp }
  | { op: 'all' | 'any'; conditions: Condition[] }
  | { op: 'not'; condition: Condition };

export interface Rule {
  id: string;
  title: string;
  severity: Severity;
  /** Kinds the rule applies to; `*` means every kind. */
  kinds: string[];
  scopes: RuleScope[];
  when: Condition;
  /** Paths (tried in order) whose line the finding points at. Defaults to the scope itself. */
  report: string[];
  message: string;
  why?: string;
  fix?: string;
  /** Where the rule was loaded from, for error messages. */
  origin?: string;
}

export interface Finding {
  ruleId: string;
  title: string;
  severity: Severity;
  message: string;
  why?: string;
  fix?: string;
  /** 1-based line the finding points at. */
  line: number;
  /** Full path of the field the finding points at, when it exists in the manifest. */
  path?: string;
}

export interface CheckedDocument {
  index: number;
  startLine: number;
  apiVersion?: string;
  kind?: string;
  name?: string;
  issues: { message: string; line?: number }[];
  findings: Finding[];
}

export interface CheckResult {
  documents: CheckedDocument[];
}
