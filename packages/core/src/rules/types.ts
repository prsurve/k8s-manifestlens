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

/** How much a fix can change what runs. Low is safe to apply in bulk; high is never applied unasked. */
export type FixRisk = 'low' | 'medium' | 'high';

/** One field a fix sets. The value is either written in the rule or supplied by a team policy. */
export interface FixSet {
  /** Plain dotted keys relative to the rule's scope, e.g. `securityContext.allowPrivilegeEscalation`. */
  path: string;
  /** Literal value; unused when `param` is set. */
  value?: unknown;
  /** Name of a policy parameter that supplies the value. */
  param?: string;
  /** Every scalar of a policy value must match this, so a typo cannot reach the manifest. */
  pattern?: RegExp;
}

/** A structured, deterministic fix for a rule. Rules without one are never changed automatically. */
export interface FixSpec {
  risk: FixRisk;
  /** What the patch does, in one sentence. */
  summary: string;
  /** Extra preconditions, evaluated like `when` in the rule's scope. The fix is skipped if false. */
  requires?: Condition;
  set: FixSet[];
}

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
  /** Optional machine-applicable fix. `fix` stays the human advice. */
  autofix?: FixSpec;
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
