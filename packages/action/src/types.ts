import type { Severity } from '@manifestlens/core';

export type Scope = 'all' | 'changed' | 'new';
export type Mode = 'enforce' | 'report';
export type CommentMode = 'auto' | 'always' | 'never';
/** The lowest severity that counts as a failure, or `none` to never fail on findings. */
export type FailOn = Severity | 'none';
/** What a rule's severity can be overridden to; `off` disables the rule. */
export type RuleSeverity = Severity | 'off';

/** Silence rules for files matching a glob. Without `rules`, every rule is silenced there. */
export interface IgnoreEntry {
  path?: string;
  rules?: string[];
}

/**
 * Every setting the action understands. Each has a built-in default, can be set in the
 * checked-in config file, and can be overridden by a workflow input of the same name.
 */
export interface Settings {
  /** Glob patterns (`!` excludes) for the files to check, relative to `workingDirectory`. */
  paths: string[];
  workingDirectory: string;
  configFile: string;
  /** all: every finding. changed: only files this change touches. new: only findings the change introduces. */
  scope: Scope;
  /** Commit to compare against for `changed` and `new`; empty means work it out from the event. */
  baseRef: string;
  failOn: FailOn;
  /** `null` means "derive from failOn" (errors, warnings, info) or "no limit" (total). */
  maxErrors: number | null;
  maxWarnings: number | null;
  maxInfo: number | null;
  maxTotal: number | null;
  failOnParseError: boolean;
  /** report: findings never fail the build. */
  mode: Mode;
  /** Compute and log everything, but touch nothing: no annotations, no comment, never fails. */
  dryRun: boolean;
  /** Extra rule files or folders (YAML). */
  rules: string[];
  disableRules: string[];
  severityOverrides: Record<string, RuleSeverity>;
  ignore: IgnoreEntry[];
  annotations: boolean;
  maxAnnotations: number;
  comment: CommentMode;
  summary: boolean;
  /** Where to write a SARIF file for code scanning; empty means do not write one. */
  sarifFile: string;
  reportFile: string;
  /** Names this run, so matrix jobs get separate summaries and separate PR comments. */
  label: string;
  maxFiles: number;
  maxFileSizeKb: number;
}

export type SettingKey = keyof Settings;
export type Source = 'default' | 'config' | 'input' | 'config+input';
export type Layer = Partial<Settings>;

/** A finding with the file it was found in. */
export interface LocatedFinding {
  file: string;
  line: number;
  ruleId: string;
  severity: Severity;
  message: string;
  why?: string;
  fix?: string;
  /** e.g. `Deployment "web"` */
  object?: string;
}

export interface ParseProblem {
  file: string;
  line?: number;
  message: string;
}

/** One object that changed, for the "what this change does" section. */
export interface ChangedObject {
  file: string;
  object: string;
  status: 'added' | 'removed' | 'changed';
  notes: string[];
  effects: string[];
}

export interface Analysis {
  findings: LocatedFinding[];
  parseProblems: ParseProblem[];
  suppressed: number;
  filesChecked: number;
  changes: ChangedObject[];
  /** Rule ids named in settings that no rule has: usually a typo. */
  unknownRules: string[];
}
