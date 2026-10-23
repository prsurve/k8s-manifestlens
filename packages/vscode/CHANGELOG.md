# Changelog

## Unreleased

- Quick fixes (lightbulb) for findings that have a safe automatic fix. Each is labelled with its risk.
- `ManifestLens: Fix this manifest (preview first)` opens a diff and asks before applying. Undo with
  `Ctrl+Z`.
- Settings: `manifestlens.fixMaxRisk` and `manifestlens.fixPolicy`.

## 0.1.0

First release.

- Rule findings (missing limits, root containers, `latest` image tags, missing probes and more) appear
  as warnings on the right line, each with why it matters and how to fix it.
- Hover a field to see what it does, with a link to the official Kubernetes docs.
- `ManifestLens: Explain this manifest` explains the whole file line by line.
- Covers 25 kinds, including Pod, Deployment, StatefulSet, DaemonSet, Job, CronJob, Service and Ingress.
- Settings: `manifestlens.enable`, `manifestlens.minimumSeverity` and `manifestlens.rules` for your own
  rule files.
