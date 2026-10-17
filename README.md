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

- A web page (`apps/web`) does all of the above in the browser. Nothing is uploaded: the page makes no
  network requests, and its Content-Security-Policy forbids them.

- A VS Code extension (`packages/vscode`) shows the findings as warnings in the editor, explains fields
  on hover and adds an "Explain this manifest" command.

See [PLAN.md](PLAN.md) for what comes next.

## Try it

```sh
npm install
npm run build
node packages/cli/dist/main.js explain examples/web.yaml
node packages/cli/dist/main.js check examples/risky.yaml
node packages/cli/dist/main.js diff examples/diff-old.yaml examples/diff-new.yaml
```

## Development

```sh
npm run check   # typecheck, lint, format check, tests
npm run build   # builds every package
```

Run the web page locally with `npm run dev:web`.

The repo is an npm workspace:

| Path              | What it is                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| `packages/core`   | The framework-agnostic core (no Node imports): parse, explain, check, diff, rules and dataset. |
| `packages/cli`    | The `manifestlens` command line.                                                               |
| `packages/vscode` | The VS Code extension. Bundles the core into one file.                                         |
| `apps/web`        | The web page (Vite, plain TypeScript). It bundles the core, so it runs fully offline.          |
| `examples`        | Sample manifests used by the tests and the docs.                                               |

## Building the VS Code extension

```sh
npm run package -w manifestlens-vscode   # writes packages/vscode/dist/manifestlens.vsix
```

Install the file with `code --install-extension packages/vscode/dist/manifestlens.vsix`. Publishing to the
Marketplace needs a publisher account and is a separate step.

## Deploying the web page

`apps/web` builds to static files, so any static host works. On Vercel:

1. Import the GitHub repository.
2. Set **Root Directory** to `apps/web`. Leave "Include source files outside of the Root Directory" on,
   because the page bundles `packages/core`.
3. Deploy. `apps/web/vercel.json` already sets the install and build commands, the output directory and
   the security headers.

## License

Apache-2.0. See [LICENSE](LICENSE).
