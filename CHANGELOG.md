# Changelog

## Unreleased

### Added

- **Automatic fixes.** Rules can carry a structured `autofix`. `manifestlens fix <file>` previews
  validated fixes as a unified diff and writes them only with `--write` (a `.bak` copy is kept). Options:
  `--policy`, `--max-risk`, `--only`, `--no-backup`, plus `--rules` as for `check`.
  See [docs/auto-fix.md](docs/auto-fix.md).
- Five built-in fixes: `allow-privilege-escalation` (low risk), `may-run-as-root` (medium),
  `privileged-container` (high), and policy-driven `missing-memory-limit` and
  `loadbalancer-open-to-world` (medium).
- Core API: `fixManifest`, `isStale`, `unifiedDiff`, `lineEdits`, `parseFixPolicy`.
- Web page: a Fix tab with a preview, the diff and a copy button.
- VS Code extension: quick fixes and a preview-first "Fix this manifest" command.
- GitHub Action: inputs `suggest-fixes`, `fix-patch-file`, `fix-max-risk`, `fix-policy`, outputs
  `fixes-available` and `fix-patch-file`, a "Suggested fixes" summary section and a `fixes` key in the
  JSON report. All are opt in. The action never edits, commits or pushes.

### Compatibility

- Existing rules, CLI commands, Action inputs, outputs and report keys are unchanged. The `fixes` report
  key and the new summary section appear only when fixes are requested.
- Rule files accept a new optional `autofix` key. Rules without it are never modified.
