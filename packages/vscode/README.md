# ManifestLens for VS Code

Explains Kubernetes YAML in plain English and flags risky settings, right in the editor. It works
offline: nothing is sent anywhere.

## What you get

- **Warnings in the editor.** Missing resource limits, root containers, `latest` image tags, missing
  probes and more show up as squiggles on the right line. Each one says why it matters and how to fix it.
- **Explanations on hover.** Hover a field in a Pod, Deployment or Service to see what it does, with a
  link to the official Kubernetes docs.
- **Explain this manifest.** Run `ManifestLens: Explain this manifest` from the Command Palette to get the
  whole file explained line by line.

Only files that declare both `apiVersion` and `kind` are checked, so other YAML files (CI configs,
docker-compose, Helm templates) are left alone.

## Settings

| Setting                        | Default | Meaning                                                             |
| ------------------------------ | ------- | ------------------------------------------------------------------- |
| `manifestlens.enable`          | `true`  | Turn checks and hover on or off.                                    |
| `manifestlens.minimumSeverity` | `info`  | Hide findings below `info`, `warning` or `error`.                   |
| `manifestlens.rules`           | `[]`    | Extra rule files or folders. Relative paths start at the workspace. |

Rules are plain YAML. See the
[rule guide](https://github.com/prsurve/manifestlens/blob/main/docs/writing-rules.md).

## License

Apache-2.0.
