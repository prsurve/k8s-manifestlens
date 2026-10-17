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

Milestone 1 is in progress: `manifestlens explain <file>` explains Pod, Deployment and Service manifests
from a small hand-written field dataset. Rules, docs links and diff mode come later. See [PLAN.md](PLAN.md).

## Try it

```sh
npm install
npm run build
node dist/cli/main.js explain test/fixtures/web.yaml
```

## Development

```sh
npm run check   # typecheck, lint, format check, tests
```

`src/core` is runtime-agnostic (no Node imports) so a web page and editor plugin can reuse it. `src/cli` holds
the command line.

## License

Apache-2.0. See [LICENSE](LICENSE).
