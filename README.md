# ManifestLens

Explains Kubernetes YAML in plain English and flags risky settings. Local-first and offline.

**Audience:** DevOps beginners, students, platform teams onboarding new engineers.

## Planned features

- Line-by-line explanations of any manifest
- Security and best-practice hints (missing limits, root containers, `latest` tags)
- "Why does this field exist?" links to the official docs
- Diff mode: explain what a change will do to the cluster
- Fully offline, using a bundled rules engine

## Status

Milestones 1 to 3:

- `manifestlens explain <file>` explains Pod, Deployment and Service manifests line by line, from a
  small hand-written field dataset.
- `manifestlens check <file>` flags risky settings with 16 starter rules written as plain YAML. See
  [docs/writing-rules.md](docs/writing-rules.md) to add your own.
- `explain` links each field to the official Kubernetes docs (`npm run check-links` verifies the links).
- `manifestlens diff <old> <new>` explains what applying a changed manifest will do (scaling, rollouts,
  restarts, rejected changes) and which findings the change adds or removes. Use `--fail-on warning` to
  fail a CI job when a change introduces new problems.

See [PLAN.md](PLAN.md) for what comes next.

## Try it

```sh
npm install
npm run build
node dist/cli/main.js explain test/fixtures/web.yaml
node dist/cli/main.js check test/fixtures/risky.yaml
node dist/cli/main.js diff test/fixtures/diff-old.yaml test/fixtures/diff-new.yaml
```

## Development

```sh
npm run check   # typecheck, lint, format check, tests
```

`src/core` is runtime-agnostic (no Node imports) so a web page and editor plugin can reuse it. `src/cli` holds
the command line.

## License

Apache-2.0. See [LICENSE](LICENSE).
