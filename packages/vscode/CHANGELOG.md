# Changelog

## 0.3.1

- Also published on Open VSX, so VSCodium, Cursor, Windsurf and similar editors can install it from their built-in extension view. No functional changes.

## 0.3.0

- **Add support for kinds ManifestLens does not cover.** A quick fix on the "unsupported kind" message and the
  commands `Add a custom resource or kind schema…` and `Manage imported kinds` import a CRD or an OpenAPI schema,
  preview what it can and cannot check, and re-check open files. Imported kinds persist.
- New setting `k8sManifestlens.kinds`: kind registry files or folders (JSON), for example one committed to the repository.

## 0.2.0

- **Renamed to k8s-manifestlens.** This is a new extension, `prsurve.k8s-manifestlens-vscode`. The old
  `prsurve.manifestlens-vscode` is deprecated: install this one instead. Settings now start with
  `k8sManifestlens.` (`manifestlens.` before), so set them again once.
- Quick fixes (lightbulb) for findings that have a safe automatic fix. Each is labelled with its risk.
- `k8s-manifestlens: Fix this manifest (preview first)` opens a diff and asks before applying. Undo with
  `Ctrl+Z`.
- Settings: `k8sManifestlens.fixMaxRisk` and `k8sManifestlens.fixPolicy`.

## 0.1.0

First release (as `manifestlens-vscode`).

- Rule findings (missing limits, root containers, `latest` image tags, missing probes and more) appear
  as warnings on the right line, each with why it matters and how to fix it.
- Hover a field to see what it does, with a link to the official Kubernetes docs.
- `ManifestLens: Explain this manifest` explains the whole file line by line.
- Covers 25 kinds, including Pod, Deployment, StatefulSet, DaemonSet, Job, CronJob, Service and Ingress.
- Settings: `manifestlens.enable`, `manifestlens.minimumSeverity` and `manifestlens.rules` for your own
  rule files.
