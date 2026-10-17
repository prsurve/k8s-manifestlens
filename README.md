# ManifestLens

Explains Kubernetes YAML in plain English and flags risky settings. Local-first and offline.

**Audience:** DevOps beginners, students, platform teams onboarding new engineers.

**Try it in your browser: <https://manifestlens-one.vercel.app>**. Paste a manifest and nothing leaves
your machine.

**Use it in GitHub Actions** to check Kubernetes manifests on every pull request and fail the build on risky
settings ([all options](docs/github-action.md), [Marketplace](https://github.com/marketplace/actions/manifestlens)):

```yaml
- uses: actions/checkout@v7
- uses: prsurve/manifestlens@v1
```

## What it does

- **Explain.** `manifestlens explain <file>` explains a manifest line by line and links each field to the
  official Kubernetes docs. Pod, Deployment and Service have plain-English text written by hand. 22 more
  kinds (StatefulSet, DaemonSet, Job, CronJob, Ingress, ConfigMap, Secret, RBAC and others) are explained
  from a dataset generated from the Kubernetes OpenAPI spec, bundled so it works offline.
- **Check.** `manifestlens check <file>` flags risky settings (missing limits, root containers, `latest`
  tags, missing probes and more) with 16 starter rules written as plain YAML. See
  [docs/writing-rules.md](docs/writing-rules.md) to add your own.
- **Diff.** `manifestlens diff <old> <new>` explains what applying a changed manifest will do (scaling,
  rollouts, restarts, rejected changes) and which findings the change adds or removes. Use
  `--fail-on warning` to fail a CI job when a change introduces new problems.
- **Web page.** `apps/web` does all of the above in the browser. Nothing is uploaded: the page makes no
  network requests, and its Content-Security-Policy forbids them. Results are compact: findings are one
  line each, click one for the why and fix, filter by severity, and click a line number to jump to that
  line in your YAML. It follows your system's light or dark theme, with a button to switch.
- **GitHub Action.** `uses: prsurve/manifestlens@v1` checks manifests in CI and passes or fails the build.
  Settings come from built-in defaults, a checked-in `.github/manifestlens.yml`, and workflow inputs, in that
  order. It can gate only on what a pull request introduces, annotates the changed lines, comments on the
  pull request, writes SARIF, and has a report-only mode. See [docs/github-action.md](docs/github-action.md).
- **VS Code extension.** `packages/vscode` shows the findings as warnings in the editor, explains fields on
  hover and adds an "Explain this manifest" command.

See [PLAN.md](PLAN.md) for the roadmap.

## Try it locally

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

## Field dataset

Explanations come from two places. Text written by hand (`packages/core/src/fields/pod.ts` and friends)
always wins, and is used for every Pod template too, so a StatefulSet's containers read the same as a
Pod's. Everything else comes from `packages/core/src/fields/generated/schema.ts`, generated from the
Kubernetes OpenAPI spec. To refresh it for a new Kubernetes release:

```sh
curl -fLo /tmp/swagger.json https://raw.githubusercontent.com/kubernetes/kubernetes/v1.37.1/api/openapi-spec/swagger.json
npm run generate-schema -- --spec /tmp/swagger.json --version v1.37.1
```

To cover another kind, add it to `ROOTS` in `packages/core/scripts/generate-schema.mjs`. The Kubernetes
documentation is Apache-2.0 licensed; see [NOTICE](NOTICE).

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
